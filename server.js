const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 8080;

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'bubblewrap-super-secret-key-12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS, false is fine for HTTP
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Initialize SQLite database
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'bubblewrap.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Error opening database:", err.message);
  } else {
    console.log("📂 Connected to SQLite database.");
    initializeTables();
  }
});

function initializeTables() {
  db.serialize(() => {
    // Create Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        displayName TEXT NOT NULL,
        isAdmin INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL
      )
    `);

    // Create Stats table
    db.run(`
      CREATE TABLE IF NOT EXISTS stats (
        uid TEXT PRIMARY KEY,
        totalPopped INTEGER DEFAULT 0,
        poppedToday INTEGER DEFAULT 0,
        longestStreak INTEGER DEFAULT 0,
        currentStreak INTEGER DEFAULT 0,
        sheetsRefilled INTEGER DEFAULT 0,
        lastActiveDate TEXT,
        unlockedSkins TEXT DEFAULT '["classic"]',
        selectedSkin TEXT DEFAULT 'classic',
        dailyStreak INTEGER DEFAULT 0,
        lastDailyCompletedDate TEXT,
        streakFreezes INTEGER DEFAULT 1,
        lastFreezeResetDate TEXT,
        dailySheetsCompleted INTEGER DEFAULT 0,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `, () => {
      // Seed default admin user if not present
      const adminEmail = 'admin@bubblewrap.com';
      db.get("SELECT * FROM users WHERE email = ?", [adminEmail], (err, row) => {
        if (err) {
          console.error("Admin check query error:", err.message);
          return;
        }
        if (!row) {
          const uid = 'admin-uid-' + Math.random().toString(36).substr(2, 9);
          const defaultPassword = 'adminpassword123';
          const salt = bcrypt.genSaltSync(10);
          const passwordHash = bcrypt.hashSync(defaultPassword, salt);
          const now = new Date().toISOString();
          
          db.run(
            "INSERT INTO users (uid, email, password_hash, displayName, isAdmin, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
            [uid, adminEmail, passwordHash, 'System Admin', 1, now],
            (err) => {
              if (err) {
                console.error("Failed to seed admin user:", err.message);
              } else {
                console.log(`=============================================`);
                console.log(`🔑 Seeded admin user: ${adminEmail}`);
                console.log(`🔑 Password: ${defaultPassword}`);
                console.log(`=============================================`);
                
                // Seed stats for admin user
                db.run(
                  "INSERT INTO stats (uid, totalPopped, poppedToday, longestStreak, currentStreak, sheetsRefilled, lastActiveDate, unlockedSkins, selectedSkin, dailyStreak, lastDailyCompletedDate, streakFreezes, lastFreezeResetDate, dailySheetsCompleted, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                  [uid, 1250, 250, 42, 0, 5, now.split('T')[0], JSON.stringify(['classic', 'holographic', 'glow']), 'classic', 3, now.split('T')[0], 1, now.split('T')[0], 1, now],
                  (err) => {
                    if (err) console.error("Admin stats seed error:", err.message);
                  }
                );
              }
            }
          );
        }
      });
    });
  });
}

// --- API Authentication Endpoints ---

// User Registration
app.post('/api/auth/signup', (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const emailKey = email.toLowerCase().trim();
  db.get("SELECT * FROM users WHERE email = ?", [emailKey], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Database error during email check." });
    }
    if (row) {
      return res.status(400).json({ error: "auth/email-already-in-use" });
    }

    const uid = 'uid-' + Math.random().toString(36).substr(2, 9);
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    db.run(
      "INSERT INTO users (uid, email, password_hash, displayName, isAdmin, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      [uid, emailKey, passwordHash, displayName, 0, now],
      (err) => {
        if (err) {
          return res.status(500).json({ error: "Failed to create user account." });
        }

        // Initialize default stats profile
        db.run(
          "INSERT INTO stats (uid, totalPopped, poppedToday, longestStreak, currentStreak, sheetsRefilled, lastActiveDate, unlockedSkins, selectedSkin, dailyStreak, lastDailyCompletedDate, streakFreezes, lastFreezeResetDate, dailySheetsCompleted, updatedAt) VALUES (?, 0, 0, 0, 0, 0, ?, '[\"classic\"]', 'classic', 0, '', 1, ?, 0, ?)",
          [uid, today, today, now],
          (err) => {
            if (err) {
              return res.status(500).json({ error: "Failed to initialize stats." });
            }

            const user = { uid, email: emailKey, displayName };
            req.session.user = user;
            res.json({ user });
          }
        );
      }
    );
  });
});

// User Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Missing email or password." });
  }

  const emailKey = email.toLowerCase().trim();
  db.get("SELECT * FROM users WHERE email = ?", [emailKey], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Database error during login." });
    }
    if (!row) {
      return res.status(400).json({ error: "auth/invalid-credential" });
    }

    const isMatch = bcrypt.compareSync(password, row.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: "auth/invalid-credential" });
    }

    const user = {
      uid: row.uid,
      email: row.email,
      displayName: row.displayName
    };
    req.session.user = user;
    res.json({ user });
  });
});

// User Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to log out." });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Get Current User Session
app.get('/api/auth/session', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.json({ user: null });
  }
});

// --- API Stats Endpoints ---

// Get Stats for current user
app.get('/api/stats', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const uid = req.session.user.uid;
  db.get("SELECT * FROM stats WHERE uid = ?", [uid], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Database error fetching stats." });
    }
    if (!row) {
      return res.json(null);
    }
    
    // Parse JSON field
    try {
      row.unlockedSkins = JSON.parse(row.unlockedSkins);
    } catch (e) {
      row.unlockedSkins = ['classic'];
    }

    res.json(row);
  });
});

// Sync/Update Stats for current user
app.post('/api/stats', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const uid = req.session.user.uid;
  const {
    totalPopped,
    poppedToday,
    longestStreak,
    currentStreak,
    sheetsRefilled,
    lastActiveDate,
    unlockedSkins,
    selectedSkin,
    dailyStreak,
    lastDailyCompletedDate,
    streakFreezes,
    lastFreezeResetDate,
    dailySheetsCompleted
  } = req.body;

  const now = new Date().toISOString();
  const unlockedSkinsStr = Array.isArray(unlockedSkins) ? JSON.stringify(unlockedSkins) : '["classic"]';

  db.run(
    `INSERT INTO stats (
      uid, totalPopped, poppedToday, longestStreak, currentStreak, sheetsRefilled, 
      lastActiveDate, unlockedSkins, selectedSkin, dailyStreak, lastDailyCompletedDate, 
      streakFreezes, lastFreezeResetDate, dailySheetsCompleted, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      totalPopped = excluded.totalPopped,
      poppedToday = excluded.poppedToday,
      longestStreak = excluded.longestStreak,
      currentStreak = excluded.currentStreak,
      sheetsRefilled = excluded.sheetsRefilled,
      lastActiveDate = excluded.lastActiveDate,
      unlockedSkins = excluded.unlockedSkins,
      selectedSkin = excluded.selectedSkin,
      dailyStreak = excluded.dailyStreak,
      lastDailyCompletedDate = excluded.lastDailyCompletedDate,
      streakFreezes = excluded.streakFreezes,
      lastFreezeResetDate = excluded.lastFreezeResetDate,
      dailySheetsCompleted = excluded.dailySheetsCompleted,
      updatedAt = excluded.updatedAt`,
    [
      uid, totalPopped, poppedToday, longestStreak, currentStreak, sheetsRefilled,
      lastActiveDate, unlockedSkinsStr, selectedSkin, dailyStreak, lastDailyCompletedDate,
      streakFreezes, lastFreezeResetDate, dailySheetsCompleted, now
    ],
    (err) => {
      if (err) {
        console.error("Database update stats error:", err.message);
        return res.status(500).json({ error: "Database error updating stats." });
      }
      res.json({ success: true });
    }
  );
});

// Shared Leaderboard Endpoint (Top 5)
app.get('/api/leaderboard', (req, res) => {
  db.all(
    `SELECT u.displayName, s.totalPopped, s.uid
     FROM stats s 
     JOIN users u ON s.uid = u.uid 
     ORDER BY s.totalPopped DESC 
     LIMIT 5`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Failed to retrieve leaderboard." });
      }
      res.json(rows);
    }
  );
});

// --- API Admin Endpoints ---

// Get all users' stats (Admin console backend)
app.get('/api/admin/users', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const email = req.session.user.email;
  const adminWhitelist = ['admin@bubblewrap.com'];
  if (!adminWhitelist.includes(email.toLowerCase())) {
    return res.status(403).json({ error: "Forbidden: Admins only." });
  }

  db.all(
    `SELECT u.uid, u.displayName, u.email, u.createdAt as signupDate,
            s.totalPopped, s.poppedToday, s.dailyStreak, s.lastActiveDate, s.selectedSkin, s.sheetsRefilled
     FROM users u
     LEFT JOIN stats s ON u.uid = s.uid`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error fetching users." });
      }
      res.json(rows);
    }
  );
});

// Serve static files from workspace root
app.use(express.static(path.join(__dirname)));

// Single-page application fallback route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`🚀 Virtual Bubble Wrap static server running!`);
  console.log(`👉 Address: http://localhost:${PORT}`);
  console.log(`=============================================`);
});
