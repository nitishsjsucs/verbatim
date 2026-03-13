const { MongoClient } = require('./web/node_modules/mongodb')
const { resetActionables } = require('./reset-actionables')
const { generateSyntheticActionables } = require('./generate-synthetic-actionables')

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda'
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2'

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
    console.log('STEP 1/3 — Clearing all notifications...')
    await clearAllNotifications()

    console.log('\nSTEP 2/3 — Resetting published actionables back to "Actionables" page...')
    await resetActionables()

    console.log('\nSTEP 3/3 — Regenerating synthetic completed actionables...')
    await generateSyntheticActionables()

    console.log('\n✅ Full reset complete: notifications cleared, base 100 actionables reset, ~1300 synthetic completed actionables recreated.')
}

if (require.main === module) {
    runFullReset().catch(err => {
        console.error('\n❌ Full reset failed:', err)
        process.exit(1)
    })
}

module.exports = { runFullReset }
