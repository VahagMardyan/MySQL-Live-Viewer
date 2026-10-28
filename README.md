# MySQL Live Viewer

A small web page that shows the tables of a MySQL database and refreshes them automatically. New rows flash green and changed rows flash yellow.

## Requirements

- **Node.js 20.6 or newer** (needed for the built-in `--env-file` option). Check with `node -v`.
- A running MySQL server

## Project structure

```
  mysql-live-viewer/
  ├── .env.example       # template for your .env
  ├── .gitignore
  ├── package.json
  ├── package-lock.json
  ├── server.js          # Express backend that reads MySQL
  └── public/
      ├── index.html     # the viewer page
      ├── style.css
      └── script.js
```

## Setup

1. Create a `.env` file in the project folder:

   ```env
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=your_mysql_user_name
   DB_PASSWORD=your_password
   DB_NAME=database_name
   PORT=3000
   ```
2. Make sure the start script in `package.json` loads it:

   ```json
   "scripts": {
     "start": "node --env-file=.env server.js"
   }
   ```
3. Install dependencies and start the server:

   ```bash
   npm install
   npm start
   ```
4. Open **http://localhost:3000** in your browser.

## Usage

- Click a tab to switch tables. The number next to each name is its row count.
- Choose a refresh interval (1s to 10s) or press **Pause** to stop updates.
- Run an `INSERT` or `UPDATE` in MySQL and watch the change appear on the page.

## Notes

- Each table shows up to 1000 rows (you can change it from `server.js`), sorted by primary key.
- Add `.env` and `node_modules/` to `.gitignore` so your password is never pushed.
- If you see `Access denied`, check `DB_USER` and `DB_PASSWORD` in `.env`.
