# MySQL Live Viewer

A small web app that shows the tables of a MySQL database and refreshes them automatically. New rows flash green and changed rows flash yellow. Tables are shown one page at a time, so even tables with millions of rows stay fast. You can sort by any column, group by a column with aggregates, and inspect each table's structure and constraints.

Works with MySQL 8 and MariaDB 10.2+.

## Requirements

- **Node.js 20.6 or newer** (needed for the built-in `--env-file` option). Check with `node -v`.
- A running MySQL 8 or MariaDB 10.2+ server

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

- **Tables**: click a tab to switch tables. The number is the row count; `≈` means it is MySQL's estimate (used for tables over 100,000 rows, since an exact count has to scan the table).
- **Rows per page**: 100, 250, 500 or 1,000.
- **Pages**: « first, ‹ previous, a page number box (type a number and press Enter), › next, » last. The text next to it shows which rows you're looking at, e.g. "Rows 251–500 of 2,000,000".
- **Refresh**: choose an interval (1s to 10s), or press **Pause**. Each refresh reloads only the page you're on.
- Your choices (table, view, page size, refresh) are remembered in the browser.

### Data view

Click a column header to sort: ascending ▲, then descending ▼, then back to primary-key order.

Sorting by a column **with an index** is as fast as normal paging. Sorting a large table by a column **without an index** makes MySQL sort every row on each refresh, so a yellow notice suggests adding an index or pausing:

```sql
CREATE INDEX idx_amount ON big_orders (amount);
```

### Group view

1. Pick a column in **Group by**. Each group shows its row count.
2. Optionally add aggregates: **SUM**, **AVG** (numeric columns only), **MIN**, **MAX** or **COUNT DISTINCT** of any column, up to 4. Click × on a chip to remove one.
3. Click a header to sort by the group value, the row count or an aggregate.

Grouping always reads the whole table. On large tables, results that took more than 0.3 s are reused for up to 10 seconds, and the notice says how old they are.

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

## How large tables stay fast

Measured on a 2,000,000-row MySQL 8 table:

| What | Time |
|------|------|
| Any page reached with next / previous / first / last (keyset) | ~10 ms |
| Jump to a page number (deferred join, from the nearer end) | up to ~0.45 s in the middle |
| Same jump with plain `LIMIT … OFFSET` (not used) | ~1.4 s |
| Exact `COUNT(*)` | ~0.2 s, cached for 15 s |
| Sorted page, indexed column | ~15 ms |
| Sorted page, unindexed column | ~2 s |
| GROUP BY with aggregates | 1–2.5 s, cached for 10 s if slow |

- **Keyset pagination**: next and previous pages continue from the last or first row shown: `WHERE (sort_col, id) > (…) ORDER BY sort_col, id LIMIT 250`. MySQL reads exactly one page from the index, however deep you are. It needs a primary key. Sorting by a nullable or `FLOAT` column falls back to page numbers, which works but makes deep pages slower.
- **Page-number jumps** skip rows using only the key columns, then load full rows for that page alone. Jumps to the second half count from the end.
- **Counts**: tabs use MySQL's instant estimate for tables over 100,000 rows; the open table gets an exact count, reused for 15 seconds.
- **Smaller responses**: rows are sent as arrays instead of objects, and responses are gzipped.

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
│   │   └── Config.js            # environment variables, page sizes, count settings
│   ├── db/
│   │   ├── Database.js          # wraps the mysql2 connection pool
│   │   └── dialects/            # MySQL vs MariaDB differences
│   │       ├── Dialect.js
│   │       ├── MySqlDialect.js
│   │       ├── MariaDbDialect.js
│   │       └── DialectFactory.js
│   ├── repositories/
│   │   ├── SchemaRepository.js  # columns, constraints and indexes from information_schema
│   │   ├── RowRepository.js     # paging queries (keyset and offset) and counts
│   │   └── GroupRepository.js   # GROUP BY queries with aggregates
│   ├── services/
│   │   ├── TableService.js      # table list, structure, pages of rows, sorting
│   │   ├── GroupService.js      # group view, with a cache for slow results
│   │   ├── RowCounter.js        # exact vs estimated counts, with a cache
│   │   ├── KeyCursor.js         # encodes page positions as URL-safe cursors
│   │   └── PageSizePolicy.js    # allowed page sizes
│   └── http/
│       ├── TableController.js   # API routes
│       └── WebServer.js         # Express setup, gzip and error handling
└── public/
    ├── index.html
    ├── style.css
    └── js/
        ├── main.js              # entry point
        ├── App.js               # state, data loading and user actions
        ├── api/ApiClient.js     # all requests to the backend
        ├── core/                # EventEmitter, Store, Poller, Preferences
        ├── components/          # Toolbar, TableTabs, ViewSwitcher, Pager, Notice, GroupBar,
        │                        # ContentArea, DataGrid, GroupTable, StructurePanel, badges, cells
        └── utils/format.js
```

## Design

**Backend** (layered, each layer only talks to the one below it):

- **Dependency injection with a composition root**: `server.js` is the only place that creates objects. Every class receives its dependencies through its constructor, so any of them can be replaced (for example with a fake repository in tests).
- **Repository**: `SchemaRepository`, `RowRepository` and `GroupRepository` hold all SQL. Nothing else writes queries.
- **Service layer**: `TableService` and `GroupService` validate requests and combine repositories into the models the API returns. They know nothing about HTTP.
- **Strategy**: `MySqlDialect` and `MariaDbDialect` handle the parts of `information_schema` that differ.
- **Factory**: `DialectFactory` picks the dialect from the server's `VERSION()`. `Config.fromEnv()` is a factory method that validates settings before building the config.
- **Caching proxy**: `RowCounter` sits in front of `COUNT(*)` and reuses recent results; `GroupService` does the same for slow GROUP BY queries.
- **Errors carry their HTTP status**, so `WebServer` maps them to responses in one place.

**Frontend**:

- **Observer**: `Store` extends `EventEmitter` and notifies components on every state change.
- **Single source of truth**: all UI state lives in the `Store`. Components only render and call `App` actions; `App` is the only code that changes state.
- **Composite / delegation**: `ContentArea` chooses between `DataGrid`, `GroupTable` and `StructurePanel`, and turns clicks inside them into actions.
- Only the active view's data is loaded, and stale responses are ignored: if you switch pages while a request is running, the old answer is dropped.

## API

| Endpoint | Returns |
|----------|---------|
| `GET /api/meta` | database name, server version, page sizes, aggregate functions |
| `GET /api/tables` | tables with row counts (`exact: false` means estimated) |
| `GET /api/tables/:name/rows` | one page of rows, see below |
| `GET /api/tables/:name/groups` | one page of groups, see below |
| `GET /api/tables/:name/structure` | columns, primary key, foreign keys, unique and check constraints |

**Rows**: `?size=250` plus optional `sort=column&dir=asc|desc`, and one of `page=N`, `page=last`, `after=<cursor>`, `before=<cursor>` (cursors come from `lastCursor` / `firstCursor` in the previous response). Rows are arrays in the order of `columns`.

**Groups**: `?by=column&agg=sum:amount,max:order_date&sort=count|group|0|1…&dir=desc&size=250&page=1`. Each group is `[value, count, ...aggregates]`.

## Notes

- Page sizes, the estimate threshold and the count cache time are set at the top of `src/config/Config.js`.
- `.env` and `node_modules/` are listed in `.gitignore`, so your password is never pushed.
- If you see `Access denied`, check `DB_USER` and `DB_PASSWORD` in `.env`.
- Check constraints need MySQL 8.0.16 or newer (or MariaDB 10.2+); on older versions the list is just empty.
