const { MySqlDialect } = require("./MySqlDialect");
const { MariaDbDialect } = require("./MariaDbDialect");

/** Factory: picks the right Dialect from the server's VERSION() string. */
class DialectFactory {
  static fromVersion(version) {
    return /mariadb/i.test(version) ? new MariaDbDialect() : new MySqlDialect();
  }
}

module.exports = { DialectFactory };
