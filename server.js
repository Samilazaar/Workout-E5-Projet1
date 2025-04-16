require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cheerio = require('cheerio');
const CronJob = require('cron').CronJob;

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration CORS plus permissive
const corsOptions = {
    origin: '*', // Permet toutes les origines en développement
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));

// Middleware pour les headers CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Middleware pour parser le JSON
app.use(express.json());

// Middleware pour servir les fichiers statiques
app.use(express.static(path.join(__dirname)));

// Connexion à la base de données MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: true
    }
});

// Test de connexion plus détaillé
db.connect(err => {
    if (err) {
        console.error('Erreur détaillée de connexion à MySQL:', {
            code: err.code,
            errno: err.errno,
            sqlMessage: err.sqlMessage,
            sqlState: err.sqlState
        });
        return;
    }

    console.log('Configuration de connexion:', {
        host: db.config.host,
        user: db.config.user,
        database: db.config.database,
        port: db.config.port
    });

    // Test de requête pour vérifier la connexion
    db.query('SELECT DATABASE() as db', (err, results) => {
        if (err) {
            console.error('Erreur de requête test:', err);
            return;
        }
        console.log('Base de données active:', results[0].db);
    });

    // Vérifier que la table existe
    db.query('SHOW TABLES LIKE "seances"', (err, results) => {
        if (err) {
            console.error('Erreur lors de la vérification de la table:', err);
            return;
        }
        if (results.length === 0) {
            console.error('La table seances n\'existe pas !');
            return;
        }
        console.log('Connecté à la base de données MySQL et table seances trouvée');
    });

    // Ajoute après la configuration de la base de données
    db.query('SELECT 1', (err) => {
        if (err) {
            console.error('Erreur de connexion MySQL:', err);
            process.exit(1);
        }
        console.log('Connexion MySQL établie');
    });
});

// Middleware d'authentification
const auth = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            console.log('Pas d\'en-tête d\'autorisation');
            return res.status(401).json({ error: 'Authentification requise' });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            console.log('Pas de token trouvé');
            return res.status(401).json({ error: 'Token manquant' });
        }

        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Token décodé:', decodedToken);

        req.userData = {
            userId: decodedToken.userId,
            isAdmin: decodedToken.isAdmin
        };
        next();
    } catch (error) {
        console.error('Erreur d\'authentification:', error);
        res.status(401).json({ error: 'Token invalide' });
    }
};

// Route pour récupérer les séances
app.get('/api/seances', auth, (req, res) => {
    console.log('GET /api/seances appelé');
    console.log('User ID:', req.userData.userId);

    const sql = `
        SELECT 
            id,
            DATE_FORMAT(date_seance, '%Y-%m-%d') as date_seance,
            creneau,
            type,
            contenu
        FROM seances 
        WHERE utilisateur_id = ?
        ORDER BY date_seance ASC, creneau ASC
    `;

    db.query(sql, [req.userData.userId], (err, results) => {
        if (err) {
            console.error('Erreur MySQL:', err);
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        console.log('Séances trouvées:', results.length);
        res.json(results);
    });
});

// Route pour ajouter une séance
app.post('/api/seances', auth, (req, res) => {
    console.log('POST /api/seances appelé');
    console.log('Données reçues:', req.body);
    console.log('User ID:', req.userData.userId);

    const { date_seance, creneau, type, contenu } = req.body;

    // Vérification des données
    if (!date_seance || !creneau || !type || !contenu) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    const sql = `
        INSERT INTO seances (utilisateur_id, date_seance, creneau, type, contenu)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sql, [req.userData.userId, date_seance, creneau, type, contenu], (err, result) => {
        if (err) {
            console.error('Erreur MySQL:', err);
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        console.log('Séance ajoutée, ID:', result.insertId);
        res.status(201).json({
            message: 'Séance ajoutée avec succès',
            id: result.insertId
        });
    });
});

// Route pour la suppression
app.delete('/api/seances/:id', (req, res) => {
    const id = parseInt(req.params.id);
    console.log('Tentative de suppression - Détails:', {
        id_recu: req.params.id,
        id_converti: id,
        type_id: typeof id
    });

    if (isNaN(id)) {
        console.log('ID invalide');
        return res.status(400).json({ error: 'ID invalide' });
    }

    // Vérification avec log SQL
    const selectSql = 'SELECT * FROM seances WHERE id = ?';
    console.log('Requête de vérification:', selectSql, [id]);

    db.query(selectSql, [id], (err, rows) => {
        if (err) {
            console.error('Erreur lors de la vérification:', err);
            return res.status(500).json({ error: 'Erreur serveur' });
        }

        console.log('Résultat de la vérification:', rows);

        if (rows.length === 0) {
            console.log('Séance non trouvée avec ID:', id);
            return res.status(404).json({ error: 'Séance non trouvée' });
        }

        console.log('Séance trouvée:', rows[0]);

        const deleteSql = 'DELETE FROM seances WHERE id = ?';
        console.log('Requête de suppression:', deleteSql, [id]);

        db.query(deleteSql, [id], (err, result) => {
            if (err) {
                console.error('Erreur MySQL lors de la suppression:', err);
                return res.status(500).json({ error: 'Erreur serveur' });
            }

            console.log('Résultat de la suppression:', result);

            if (result.affectedRows === 0) {
                console.log('Échec de la suppression pour ID:', id);
                return res.status(404).json({ error: 'Suppression impossible' });
            }

            console.log('Séance supprimée avec succès, ID:', id);
            res.json({ success: true });
        });
    });
});

// Route d'inscription
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`;
        db.query(sql, [username, email, hashedPassword], (err, result) => {
            if (err) {
                console.error('Erreur inscription:', err);
                return res.status(500).json({ error: 'Email déjà utilisé' });
            }

            const token = jwt.sign(
                { userId: result.insertId },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.status(201).json({ token });
        });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route de connexion
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    console.log('Tentative de connexion pour:', email);

    const sql = `SELECT * FROM users WHERE email = ?`;

    db.query(sql, [email], async (err, results) => {
        if (err) {
            console.error('Erreur SQL:', err);
            return res.status(500).json({ error: 'Erreur serveur' });
        }

        if (results.length === 0) {
            console.log('Utilisateur non trouvé');
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        const user = results[0];

        try {
            const valid = await bcrypt.compare(password, user.password_hash);

            if (!valid) {
                console.log('Mot de passe invalide');
                return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
            }

            const token = jwt.sign(
                {
                    userId: user.id,
                    isAdmin: user.is_admin
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            console.log('Connexion réussie pour:', email);
            res.json({
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    isAdmin: user.is_admin
                }
            });
        } catch (error) {
            console.error('Erreur bcrypt:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });
});

// Configuration des sources pour le scraping
const sources = {
    // Sources pour les conseils sportifs
    sport: [
        {
            url: 'https://www.lequipe.fr/Coaching/Fitness/',
            selector: 'article',
            titleSelector: '.title',
            contentSelector: '.description'
        },
        {
            url: 'https://www.doctissimo.fr/forme/news',
            selector: '.article-item',
            titleSelector: '.title',
            contentSelector: '.excerpt'
        }
    ],
    // Sources pour les conseils de travail/études
    travail: [
        {
            url: 'https://www.letudiant.fr/etudes/conseils.html',
            selector: '.article',
            titleSelector: '.title',
            contentSelector: '.description'
        },
        {
            url: 'https://www.studyrama.com/formations/conseils',
            selector: '.article',
            titleSelector: 'h2',
            contentSelector: '.content'
        }
    ]
};

// Fonction qui récupère et sauvegarde les conseils automatiquement
async function scrapeAndSave() {
    try {
        // Pour chaque type de conseil (sport et travail)
        for (const type of ['sport', 'travail']) {
            // Pour chaque source de ce type
            for (const source of sources[type]) {
                try {
                    console.log(`Récupération des conseils depuis ${source.url}`);
                    // Fait une requête HTTP vers la source
                    const response = await axios.get(source.url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0...' // Simule un navigateur
                        }
                    });

                    // Parse le HTML reçu
                    const $ = cheerio.load(response.data);

                    // Pour chaque article trouvé (limite à 2 par source)
                    $(source.selector).each((i, element) => {
                        if (i < 2) {
                            const titre = $(element).find(source.titleSelector).text().trim();
                            const contenu = $(element).find(source.contentSelector).text().trim();

                            // Si on a un titre et un contenu
                            if (titre && contenu) {
                                // Sauvegarde dans la base de données
                                const sql = `
                                    INSERT INTO conseils 
                                    (date_publication, type, titre, contenu, source, auteur) 
                                    VALUES (CURDATE(), ?, ?, ?, ?, ?)
                                    ON DUPLICATE KEY UPDATE
                                    contenu = VALUES(contenu)
                                `;

                                db.query(sql, [
                                    type,
                                    titre.substring(0, 255),
                                    contenu,
                                    source.url,
                                    'auto-generated'
                                ], (err) => {
                                    if (err) {
                                        console.error(`Erreur d'insertion:`, err);
                                    }
                                });
                            }
                        }
                    });
                } catch (sourceError) {
                    console.error(`Erreur pour la source ${source.url}:`, sourceError);
                }
            }
        }
        console.log('Mise à jour des conseils terminée');
    } catch (error) {
        console.error('Erreur générale du scraping:', error);
    }
}

// Route API pour récupérer les conseils
app.get('/api/conseils', (req, res) => {
    console.log('Route /api/conseils appelée');
    // Requête SQL pour récupérer les 10 derniers conseils
    const sql = `
        SELECT 
            id,
            DATE_FORMAT(date_publication, '%d/%m/%Y') as date,
            type,
            titre,
            contenu,
            source
        FROM conseils 
        ORDER BY date_publication DESC
        LIMIT 10
    `;

    // Exécution de la requête
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Erreur MySQL:', err);
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        console.log(`${results.length} conseils trouvés`);
        res.json(results);
    });
});

// Exécute le scraping au démarrage du serveur
scrapeAndSave();

// Programme le scraping tous les jours à minuit
const job = new CronJob('0 0 * * *', scrapeAndSave);
job.start();

// Route pour la page d'accueil
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Serveur API lancé sur http://localhost:${PORT}`);
});