// services/db.js - RadiusCompliance database connection
// Same pattern as RadiusBifrost connection in Pulse, separate env vars.
const sql = require('mssql');

const config = {
    user: process.env.COMPLIANCE_DB_USER || 'bifrostadmin',
    password: process.env.COMPLIANCE_DB_PASSWORD || '',
    server: process.env.COMPLIANCE_DB_SERVER || 'refugehouse-bifrost-server.database.windows.net',
    database: process.env.COMPLIANCE_DB_NAME || 'RadiusCompliance',
    options: {
        encrypt: true,
        trustServerCertificate: false,
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 2,
        idleTimeoutMillis: 60000,
        acquireTimeoutMillis: 30000
    },
    connectionTimeout: 30000,
    requestTimeout: 30000
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('[DB] Connected to RadiusCompliance database');
        pool.on('error', err => {
            console.error('[DB] SQL Pool Error:', err);
        });
        return pool;
    })
    .catch(err => {
        console.error('[DB] RadiusCompliance connection failed:', err.message);
        throw err;
    });

module.exports = { sql, poolPromise };
