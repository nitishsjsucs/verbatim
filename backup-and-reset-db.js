const { MongoClient } = require('./web/node_modules/mongodb');
const fs = require('fs');
const path = require('path');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

async function backupDatabase() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupDir = path.join(__dirname, `backup_${timestamp}`);
    
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        console.log(`✅ Connected to MongoDB`);
        
        const db = client.db(DEFAULT_DB);
        const collections = await db.listCollections().toArray();
        
        console.log(`\n📦 Backing up ${collections.length} collections to: ${backupDir}\n`);
        
        for (const collInfo of collections) {
            const collName = collInfo.name;
            const coll = db.collection(collName);
            const docs = await coll.find({}).toArray();
            
            const backupFile = path.join(backupDir, `${collName}.json`);
            fs.writeFileSync(backupFile, JSON.stringify(docs, null, 2), 'utf8');
            
            console.log(`   ✓ ${collName}: ${docs.length} documents → ${collName}.json`);
        }
        
        console.log(`\n✅ Backup complete: ${backupDir}\n`);
        return backupDir;
    } catch (error) {
        console.error('❌ Backup failed:', error);
        throw error;
    } finally {
        await client.close();
    }
}

async function dropAllCollections() {
    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const collections = await db.listCollections().toArray();
        
        console.log(`🗑️  Dropping ${collections.length} collections from ${DEFAULT_DB}...\n`);
        
        for (const collInfo of collections) {
            const collName = collInfo.name;
            await db.collection(collName).drop();
            console.log(`   ✓ Dropped: ${collName}`);
        }
        
        console.log(`\n✅ All collections dropped from ${DEFAULT_DB}\n`);
    } catch (error) {
        console.error('❌ Drop failed:', error);
        throw error;
    } finally {
        await client.close();
    }
}

async function verifyEmpty() {
    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const collections = await db.listCollections().toArray();
        
        if (collections.length === 0) {
            console.log(`✅ Database ${DEFAULT_DB} is empty\n`);
            return true;
        } else {
            console.log(`⚠️  Database still has ${collections.length} collections`);
            return false;
        }
    } finally {
        await client.close();
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  GOVINDA v2 DATABASE BACKUP & RESET');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Database: ${DEFAULT_DB}`);
    console.log(`URI: ${DEFAULT_URI.replace(/:[^:@]+@/, ':****@')}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
        // Step 1: Backup
        console.log('STEP 1/4 — Creating backup...\n');
        const backupDir = await backupDatabase();
        
        // Step 2: Drop all collections
        console.log('STEP 2/4 — Dropping all collections...\n');
        await dropAllCollections();
        
        // Step 3: Verify empty
        console.log('STEP 3/4 — Verifying database is empty...\n');
        const isEmpty = await verifyEmpty();
        
        if (!isEmpty) {
            throw new Error('Database is not empty after drop operation');
        }
        
        // Step 4: Run reset script to recreate with current code
        console.log('STEP 4/4 — Recreating database with current code...\n');
        console.log('Running reset-all-actionables.js...\n');
        
        const { runFullReset } = require('./reset-all-actionables');
        await runFullReset();
        
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('  ✅ DATABASE RESET COMPLETE');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`Backup saved to: ${backupDir}`);
        console.log('Database recreated with current code iteration');
        console.log('═══════════════════════════════════════════════════════════\n');
        
    } catch (error) {
        console.error('\n═══════════════════════════════════════════════════════════');
        console.error('  ❌ RESET FAILED');
        console.error('═══════════════════════════════════════════════════════════');
        console.error(error);
        console.error('═══════════════════════════════════════════════════════════\n');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { backupDatabase, dropAllCollections, verifyEmpty };
