const { MongoClient } = require('./web/node_modules/mongodb');

async function diagnoseDatabase() {
  const mongoUri = process.env.MONGODB_URI || 
    "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db('govinda_v2');
    
    // List all collections
    const collections = await db.listCollections().toArray();
    console.log(`📚 Collections in govinda_v2 database (${collections.length}):`);
    collections.forEach(c => console.log(`   • ${c.name}`));

    // Check for actionable/actionables related collections
    console.log('\n🔍 Searching for actionables-related collections...');
    const actionableCollections = collections.filter(c => 
      c.name.toLowerCase().includes('actionable')
    );
    
    if (actionableCollections.length === 0) {
      console.log('   ❌ No actionables collections found!');
    } else {
      actionableCollections.forEach(col => {
        console.log(`   ✓ Found: ${col.name}`);
      });

      // Count items in each actionables collection
      console.log('\n📊 Item counts:');
      for (const col of actionableCollections) {
        const collection = db.collection(col.name);
        const count = await collection.countDocuments();
        console.log(`   • ${col.name}: ${count} items`);
        
        // Show sample doc_ids
        if (count > 0) {
          const sample = await collection.findOne({});
          console.log(`     - Sample has fields: ${Object.keys(sample || {}).slice(0, 5).join(', ')}`);
          if (sample && sample.doc_id) {
            console.log(`     - Sample doc_id: ${sample.doc_id}`);
          }
        }
      }
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.close();
  }
}

diagnoseDatabase();
