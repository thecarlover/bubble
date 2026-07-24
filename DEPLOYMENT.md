# Production Deployment Guide (Free Hosting Options)

This guide provides step-by-step instructions to deploy the **Virtual Bubble Wrap** full-stack Node.js + Express + SQLite app to production using popular free (or trial) cloud platforms.

Since this application uses SQLite to persist user profiles, progress, and leaderboard stats, the chosen hosting platform must support a persistent disk (volume). On stateless hosting platforms (such as standard free Render web services or Vercel), the database file (`bubblewrap.db`) will be deleted whenever the server restarts or scales down to zero.

---

## Option 1: Fly.io (Recommended Free Tier for SQLite)

Fly.io is the best free option for SQLite because they offer a generous free allowance (3 shared CPUs, 3GB volume storage, and 256MB VMs) and natively support persistent volumes.

### Prerequisites
1. Install the Fly CLI:
   - macOS/Linux: `curl -L https://fly.io/install.sh | sh`
   - Windows (PowerShell): `iwr https://fly.io/install.ps1 -useb | iex`
2. Run `fly auth signup` or `fly auth login`.

### Deployment Steps
1. Run the fly initialization wizard in your project root:
   ```bash
   fly launch
   ```
   - *App Name*: Choose a name (e.g. `virtual-bubble-wrap`) or let it generate one.
   - *Select Region*: Choose the region closest to you.
   - *Database Setup*: Select **No** (we will use our local SQLite database).
   - *Modify Configuration*: Choose **No** (or **Yes** if you want to inspect details in your browser).

2. Create a persistent volume (e.g., 1GB volume named `bubble_data`):
   ```bash
   fly volumes create bubble_data --size 1
   ```

3. Update the generated `fly.toml` file to mount the volume. Add this section to the bottom:
   ```toml
   [mounts]
     source = "bubble_data"
     destination = "/data"
   ```

4. Tell the Node.js application to store the SQLite database inside the mounted volume directory by setting the environment variable `DATABASE_URL` (or setting the path to `/data/bubblewrap.db`).
   In your `server.js`, it automatically looks for a local file. We can configure the path to use `/data/bubblewrap.db` if it runs in production, or configure the DB path via environment variables:
   ```bash
   fly secrets set DATABASE_PATH="/data/bubblewrap.db"
   ```
   *(Note: The modified `server.js` checks if the `DATABASE_PATH` env variable is set and falls back to `path.join(__dirname, 'bubblewrap.db')` if not).*

5. Deploy your application:
   ```bash
   fly deploy
   ```
   Your app will be live at `https://<your-app-name>.fly.dev`.

---

## Option 2: Render.com (Free Tier Node.js Web Service)

Render offers free web hosting for Node.js apps. While the free tier **does not** support persistent volumes (so the database will reset when the server restarts/re-deploys), it is extremely easy to set up for testing.

### Deployment Steps (GitHub Integration)
1. Commit and push your code to a public or private GitHub repository.
2. Log in to [Render.com](https://dashboard.render.com/) and click **New > Web Service**.
3. Connect your GitHub repository.
4. Configure the service:
   - **Name**: `virtual-bubble-wrap`
   - **Environment**: `Node`
   - **Region**: Select closest to your users.
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Select **Free**.
5. Click **Deploy Web Service**.

> [!WARNING]
> **Data Persistence on Render Free Tier:**
> Because Render's Free Plan does not support disks, the `bubblewrap.db` file will be reset every time Render restarts your container (due to inactivity scale-down, new deploys, or server updates).
> To persist database records on Render in production:
> 1. Upgrade to a paid plan ($7/mo) and attach a **Render Disk** (persistent volume). Set `DATABASE_PATH` in environment variables to your mounted disk directory (e.g. `/opt/render/project/src/data/bubblewrap.db`).
> 2. Alternatively, modify `server.js` to connect to a free external hosted PostgreSQL database (like **Supabase** or **Neon.tech**) instead of local SQLite.

---

## Option 3: Koyeb (Free Tier Web Service)

Koyeb offers a free tier (5.50 GB RAM, 1 CPU, 100M API requests) supporting Docker and Node deployments.

### Deployment Steps
1. Push your code to GitHub.
2. Sign up on [Koyeb](https://www.koyeb.com/) and go to the dashboard.
3. Click **Create Service**, select **GitHub** and connect your repository.
4. Select the repository and branch.
5. Set deployment configuration:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Port**: `8080` (or leave empty to let it auto-detect)
6. Click **Deploy**.
*(Note: Similar to Render, Koyeb's free tier has ephemeral files. For persistence, you should upgrade or use an external managed Postgres database).*

---

## Option 4: Railway.app (Free Trial Credit Tier)

Railway offers easy setup with temporary deployment credits.

### Deployment Steps
1. Push your code to GitHub.
2. Sign up on [Railway.app](https://railway.app/).
3. Click **New Project > Deploy from GitHub repo** and connect your repository.
4. Railway will automatically detect the Node.js project and deploy it.
5. To enable persistent SQLite, go to the Service settings, click **Volumes > Add Volume** and mount a persistent volume (e.g. at `/data`). Add an environment variable `DATABASE_PATH` with value `/data/bubblewrap.db`.

---

## Serverless Hosting Platforms (Vercel, Netlify)

Vercel and Netlify are serverless platforms. You **cannot** run an Express server with a local SQLite database on Vercel/Netlify for production, because serverless functions are ephemeral, read-only, and state is not shared between requests.
If you deploy to Vercel:
1. You must convert the backend routes into serverless functions (Vercel API routes).
2. You must replace SQLite with a cloud database like **Supabase** (Postgres), **Neon** (serverless Postgres), or **MongoDB Atlas**.
