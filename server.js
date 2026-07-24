const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 8080;

// Trust reverse proxy (needed for secure cookies on Render/Heroku)
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
if (isProduction) {
  app.set('trust proxy', 1);
}

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'bubblewrap-super-secret-key-12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto', // Set secure dynamically based on incoming connection scheme
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    sameSite: 'lax'
  }
}));

// Initialize SQLite database
const dbPath = process.env.DATABASE_PATH || (isProduction ? '/tmp/bubblewrap.db' : path.join(__dirname, 'bubblewrap.db'));
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Error opening database:", err.message);
  } else {
    console.log("📂 Connected to SQLite database at:", dbPath);
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
    `, (err) => {
      if (err) console.error("❌ Error creating users table:", err.message);
    });

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
    `, (err) => {
      if (err) {
        console.error("❌ Error creating stats table:", err.message);
        return;
      }
      // Seed default admin user if not present
      const adminEmail = 'admin@bubblewrap.com';
      db.get("SELECT * FROM users WHERE email = ?", [adminEmail], (err, row) => {
        if (err) {
          console.error("❌ Admin check query error:", err.message);
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
                console.error("❌ Failed to seed admin user:", err.message);
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
                    if (err) console.error("❌ Admin stats seed error:", err.message);
                  }
                );
              }
            }
          );
        }
      });

      // Seed fake users for simulation analytics
      seedFakeUsers();
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

// Environment & Database diagnostics route
app.get('/api/diag', (req, res) => {
  const diag = {
    nodeEnv: process.env.NODE_ENV,
    isRender: !!process.env.RENDER,
    dbPath: dbPath,
    dbConnected: false,
    writeTest: false,
    errorMessage: null
  };

  db.get("SELECT 1", [], (err) => {
    if (err) {
      diag.errorMessage = "Database ping failed: " + err.message;
      return res.json(diag);
    }
    diag.dbConnected = true;

    // Run write test to a temporary table
    db.serialize(() => {
      db.run("CREATE TABLE IF NOT EXISTS diag_test (id INTEGER PRIMARY KEY, val TEXT)", (err) => {
        if (err) {
          diag.errorMessage = "Diag table creation failed: " + err.message;
          return res.json(diag);
        }
        
        db.run("INSERT OR REPLACE INTO diag_test (id, val) VALUES (1, 'ok')", (err) => {
          if (err) {
            diag.errorMessage = "Diag write insertion failed: " + err.message;
            return res.json(diag);
          }
          
          diag.writeTest = true;
          res.json(diag);
        });
      });
    });
  });
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

function seedFakeUsers() {
  const fakeUsers = [
    { name: 'Alex Rivera', email: 'alex@example.com', pops: 12450, streak: 12, skin: 'holographic', activeDaysAgo: 0, signupDaysAgo: 28 },
    { name: 'Emma Watson', email: 'emma@example.com', pops: 8900, streak: 6, skin: 'glow', activeDaysAgo: 1, signupDaysAgo: 25 },
    { name: 'Ryan Reynolds', email: 'ryan@example.com', pops: 6520, streak: 3, skin: 'giant', activeDaysAgo: 0, signupDaysAgo: 19 },
    { name: 'Sophia Loren', email: 'sophia@example.com', pops: 4200, streak: 0, skin: 'classic', activeDaysAgo: 4, signupDaysAgo: 18 },
    { name: 'Liam Neeson', email: 'liam@example.com', pops: 11020, streak: 8, skin: 'cosmic', activeDaysAgo: 0, signupDaysAgo: 26 },
    { name: 'Olivia Wilde', email: 'olivia@example.com', pops: 3500, streak: 1, skin: 'tiny', activeDaysAgo: 2, signupDaysAgo: 15 },
    { name: 'Noah Centineo', email: 'noah@example.com', pops: 1200, streak: 0, skin: 'classic', activeDaysAgo: 8, signupDaysAgo: 12 },
    { name: 'Ava DuVernay', email: 'ava@example.com', pops: 9500, streak: 9, skin: 'holographic', activeDaysAgo: 1, signupDaysAgo: 22 },
    { name: 'Ethan Hawke', email: 'ethan@example.com', pops: 15000, streak: 18, skin: 'cosmic', activeDaysAgo: 0, signupDaysAgo: 30 },
    { name: 'Isabella Rossellini', email: 'isabella@example.com', pops: 780, streak: 0, skin: 'classic', activeDaysAgo: 3, signupDaysAgo: 9 },
    { name: 'Mason Mount', email: 'mason@example.com', pops: 520, streak: 0, skin: 'classic', activeDaysAgo: 6, signupDaysAgo: 8 },
    { name: 'Mia Hamm', email: 'mia@example.com', pops: 6800, streak: 4, skin: 'glow', activeDaysAgo: 0, signupDaysAgo: 16 },
    { name: 'Lucas Hedges', email: 'lucas@example.com', pops: 450, streak: 0, skin: 'classic', activeDaysAgo: 11, signupDaysAgo: 5 },
    { name: 'Charlotte Gainsbourg', email: 'charlotte@example.com', pops: 3100, streak: 2, skin: 'giant', activeDaysAgo: 1, signupDaysAgo: 11 },
    { name: 'Oliver Stone', email: 'oliver@example.com', pops: 150, streak: 0, skin: 'classic', activeDaysAgo: 14, signupDaysAgo: 4 },
    { name: 'Amelia Earhart', email: 'amelia@example.com', pops: 8200, streak: 7, skin: 'holographic', activeDaysAgo: 0, signupDaysAgo: 20 },
    { name: 'Elijah Wood', email: 'elijah@example.com', pops: 250, streak: 0, skin: 'classic', activeDaysAgo: 9, signupDaysAgo: 3 },
    { name: 'Harper Lee', email: 'harper@example.com', pops: 4600, streak: 5, skin: 'tiny', activeDaysAgo: 0, signupDaysAgo: 14 },
    { name: 'James Corden', email: 'james@example.com', pops: 120, streak: 0, skin: 'classic', activeDaysAgo: 2, signupDaysAgo: 2 },
    { name: 'Evelyn Glennie', email: 'evelyn@example.com', pops: 10400, streak: 11, skin: 'cosmic', activeDaysAgo: 0, signupDaysAgo: 24 },
    { name: 'Benjamin Franklin', email: 'benjamin@example.com', pops: 95, streak: 0, skin: 'classic', activeDaysAgo: 1, signupDaysAgo: 1 },
    { name: 'Abigail Williams', email: 'abigail@example.com', pops: 45, streak: 0, skin: 'classic', activeDaysAgo: 0, signupDaysAgo: 0 }
  ];

  // Hash password once to prevent CPU block per user
  const password = 'password123';
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);
  
  const d = new Date();

  fakeUsers.forEach(u => {
    const emailKey = u.email.toLowerCase().trim();
    db.get("SELECT uid FROM users WHERE email = ?", [emailKey], (err, row) => {
      if (err) {
        console.error("❌ Error checking fake user existence:", err.message);
        return;
      }
      if (!row) {
        const uid = 'uid-sim-' + u.name.replace(/\s+/g, '').toLowerCase();
        
        const signupDate = new Date();
        signupDate.setDate(d.getDate() - u.signupDaysAgo);
        const signupDateStr = signupDate.toISOString();
        const signupDateOnlyStr = signupDateStr.split('T')[0];

        const lastActiveDate = new Date();
        lastActiveDate.setDate(d.getDate() - u.activeDaysAgo);
        const lastActiveDateOnlyStr = lastActiveDate.toISOString().split('T')[0];

        db.run(
          "INSERT INTO users (uid, email, password_hash, displayName, isAdmin, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
          [uid, emailKey, passwordHash, u.name, 0, signupDateStr],
          (err) => {
            if (err) {
              console.error("❌ Error seeding fake user:", err.message);
              return;
            }
            
            const stats = {
              totalPopped: u.pops,
              poppedToday: u.activeDaysAgo === 0 ? Math.floor(u.pops * 0.1) : 0,
              longestStreak: u.streak,
              currentStreak: u.streak,
              sheetsRefilled: Math.floor(u.pops / 80),
              lastActiveDate: lastActiveDateOnlyStr,
              unlockedSkins: JSON.stringify(['classic', 'holographic', 'glow', 'giant', 'tiny', 'cosmic'].filter((s, i) => u.pops >= [0, 100, 500, 1000, 5000, 10000][i])),
              selectedSkin: u.skin,
              dailyStreak: u.streak,
              lastDailyCompletedDate: u.activeDaysAgo === 0 ? lastActiveDateOnlyStr : "",
              streakFreezes: Math.random() > 0.5 ? 1 : 0,
              lastFreezeResetDate: signupDateOnlyStr,
              dailySheetsCompleted: Math.floor(u.pops / 120),
              updatedAt: signupDateStr
            };

            db.run(
              `INSERT INTO stats (
                uid, totalPopped, poppedToday, longestStreak, currentStreak, sheetsRefilled, 
                lastActiveDate, unlockedSkins, selectedSkin, dailyStreak, lastDailyCompletedDate, 
                streakFreezes, lastFreezeResetDate, dailySheetsCompleted, updatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                uid, stats.totalPopped, stats.poppedToday, stats.longestStreak, stats.currentStreak, stats.sheetsRefilled,
                stats.lastActiveDate, stats.unlockedSkins, stats.selectedSkin, stats.dailyStreak, stats.lastDailyCompletedDate,
                stats.streakFreezes, stats.lastFreezeResetDate, stats.dailySheetsCompleted, stats.updatedAt
              ],
              (err) => {
                if (err) console.error("❌ Error seeding fake user stats:", err.message);
              }
            );
          }
        );
      }
    });
  });
}
