# MySQL Live Viewer

A small web app that shows the tables of a MySQL database and refreshes them automatically. New rows flash green and changed rows flash yellow. A Structure view shows each column's type, default value and constraints.

Works with MySQL 8 and MariaDB.

## Requirements

- **Node.js 20.6 or newer** (needed for the built-in `--env-file` option). Check with `node -v`.
- A running MySQL or MariaDB server

## Setup

1. Copy `.env.example` to `.env` and fill in your values:

   ```env
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=your_mysql_user_name
   DB_PASSWORD=your_password
   DB_NAME=database_name
   PORT=3000
   ```

   `DB_HOST`, `DB_PORT` and `PORT` are optional and default to the values above.

2. Install dependencies and start the server:

   ```bash
   npm install
   npm start
   ```

3. Open **http://localhost:3000** in your browser.

## Usage

- **Tables**: click a tab to switch tables. The number next to each name is its row count.
- **Rows**: choose how many rows to load (1,000, 2,000, 5,000 or 10,000). The bar above the table shows "Showing X of Y rows" when a table has more.
- **Refresh**: choose an interval (1s to 10s), or press **Pause** to stop updates.
- **Data / Structure**: switch between the rows and the table definition.
- Your choices (table, view, rows, refresh) are remembered in the browser.

### Structure view

For every column: type, nullable, default value, constraints and the referenced table for foreign keys. Below the columns: the primary key, foreign keys (with `ON UPDATE` / `ON DELETE` rules), unique constraints and check constraints. Click a referenced table name to open it.

Constraint badges, also shown in the Data view headers:

| Badge | Meaning |
|-------|---------|
| PK | Primary key |
| FK | Foreign key (hover to see the target) |
| UQ | Unique (single-column) |
| NN | Not null |
| AI | Auto increment |

## Project structure

```
mysql-live-viewer/
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── server.js                    # composition root: creates objects and wires them together
├── src/
│   ├── errors.js                # AppError, NotFoundError, ValidationError, ConfigError
│   ├── config/
│   │   └── Config.js            # reads and validates environment variables
│   ├── db/
│   │   ├── Database.js          # wraps the mysql2 connection pool
│   │   └── dialects/            # MySQL vs MariaDB differences
│   │       ├── Dialect.js
│   │       ├── MySqlDialect.js
│   │       ├── MariaDbDialect.js
│   │       └── DialectFactory.js
│   ├── repositories/
│   │   ├── SchemaRepository.js  # columns and constraints from information_schema
│   │   └── RowRepository.js     # table rows and counts
│   ├── services/
│   │   ├── RowLimitPolicy.js    # allowed row limits
│   │   └── TableService.js      # builds the API models
│   └── http/
│       ├── TableController.js   # API routes
│       └── WebServer.js         # Express setup and error handling
└── public/
    ├── index.html
    ├── style.css
    └── js/
        ├── main.js              # entry point
        ├── App.js               # state, data loading and user actions
        ├── api/ApiClient.js     # all requests to the backend
        ├── core/                # EventEmitter, Store, Poller, Preferences
        ├── components/          # Toolbar, TableTabs, ViewSwitcher, ContentArea, DataGrid, StructurePanel
        └── utils/format.js
```

## Design

**Backend** (layered, each layer only talks to the one below it):

- **Dependency injection with a composition root**: `server.js` is the only place that creates objects. Every class receives its dependencies through its constructor, so any of them can be replaced (for example with a fake repository in tests).
- **Repository**: `SchemaRepository` and `RowRepository` hold all SQL. Nothing else writes queries.
- **Service layer**: `TableService` combines the repositories into the models the API returns. It knows nothing about HTTP.
- **Strategy**: `MySqlDialect` and `MariaDbDialect` handle the parts of `information_schema` that differ (default-value format, check constraints).
- **Factory**: `DialectFactory` picks the dialect from the server's `VERSION()`. `Config.fromEnv()` is a factory method that validates settings before building the config.
- **Errors carry their HTTP status**, so `WebServer` maps them to responses in one place.

**Frontend**:

- **Observer**: `Store` extends `EventEmitter` and notifies components on every state change.
- **Single source of truth**: all UI state lives in the `Store`. Components only render and call `App` actions; `App` is the only code that changes state.
- **Composite / delegation**: `ContentArea` chooses between `DataGrid` and `StructurePanel`.
- Stale responses are ignored: if you switch tables while a request is running, the old answer is dropped.

## API

| Endpoint | Returns |
|----------|---------|
| `GET /api/meta` | database name, server version, allowed row limits |
| `GET /api/tables` | tables with row counts |
| `GET /api/tables/:name/rows?limit=1000` | rows, columns, primary key, total row count |
| `GET /api/tables/:name/structure` | columns, primary key, foreign keys, unique and check constraints |

## Notes

- Rows are sorted by primary key. The allowed limits are set in `src/config/Config.js`.
- `.env` and `node_modules/` are listed in `.gitignore`, so your password is never pushed.
- If you see `Access denied`, check `DB_USER` and `DB_PASSWORD` in `.env`.
- Check constraints need MySQL 8.0.16 or newer (or MariaDB 10.2+); on older versions the list is just empty.
