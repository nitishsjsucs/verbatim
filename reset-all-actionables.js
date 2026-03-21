const { MongoClient } = require('./web/node_modules/mongodb')
const { resetActionables } = require('./reset-actionables')
const { generateSyntheticActionables } = require('./generate-synthetic-actionables')

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda'
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2'

// Parse command-line arguments
const args = process.argv.slice(2);
const shouldApply = args.includes('--apply');
const isDryRun = !shouldApply;

if (isDryRun) {
    console.log('\n📋 FULL RESET DRY-RUN MODE: Reporting changes without writing to database.\n');
}

async function clearAllNotifications() {
    const client = new MongoClient(DEFAULT_URI)
    try {
        await client.connect()
        const db = client.db(DEFAULT_DB)
        const result = await db.collection('notifications').deleteMany({})
        console.log(`   • Deleted ${result.deletedCount} notifications`)
    } catch (error) {
        console.error('Failed to clear notifications:', error)
        throw error
    } finally {
        await client.close()
    }
}

async function runFullReset() {
    if (!shouldApply) {
        console.log('STEP 1/3 — [DRY-RUN] Clearing all notifications...')
        console.log('   (would delete all notifications)\n')
    } else {
        console.log('STEP 1/3 — Clearing all notifications...')
        await clearAllNotifications()
    }

    console.log('STEP 2/3 — Resetting published actionables back to "Actionables" page...')
    // Pass through args to resetActionables (e.g., --apply or --dry-run)
    await resetActionables()

    if (!shouldApply) {
        console.log('\nSTEP 3/3 — [DRY-RUN] Regenerating synthetic completed actionables...')
        console.log('   (would recreate ~1300 synthetic completed actionables)\n')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('⚠️  FULL RESET DRY-RUN COMPLETE');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\nTo apply all changes (clear notifications, reset actionables, regenerate synthetic items),');
        console.log('run: node reset-all-actionables.js --apply\n');
    } else {
        console.log('\nSTEP 3/3 — Regenerating synthetic completed actionables...')
        await generateSyntheticActionables()
        console.log('\n✅ Full reset complete: notifications cleared, base 100 actionables reset, ~1300 synthetic completed actionables recreated.');
    }
}

if (require.main === module) {
    runFullReset().catch(err => {
        console.error('\n❌ Full reset failed:', err)
        process.exit(1)
    })
}

module.exports = { runFullReset }
