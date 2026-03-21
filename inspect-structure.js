const { MongoClient } = require('./web/node_modules/mongodb');

async function inspectDocumentStructure() {
  const mongoUri = process.env.MONGODB_URI || 
    "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db('govinda_v2');
    const collection = db.collection('actionables');

    console.log('✅ Connected to MongoDB\n');

    // Get first document to inspect structure
    const sample = await collection.findOne({});
    
    if (!sample) {
      console.log('❌ No documents found!');
      return;
    }

    console.log('📄 Document Structure:');
    console.log(`   _id: ${sample._id}`);
    console.log(`   doc_id: ${sample.doc_id}`);
    console.log(`   doc_name: ${sample.doc_name}`);
    
    // Check if actionables array exists
    if (sample.actionables) {
      console.log(`\n✓ Has 'actionables' array with ${sample.actionables.length} items \n`);
      
      // Show first item in array
      if (sample.actionables.length > 0) {
        console.log('🔍 First actionable item:');
        const firstItem = sample.actionables[0];
        console.log(JSON.stringify(firstItem, null, 2).split('\n').slice(0, 30).join('\n'));
        console.log('...\n');

        // Check for key fields
        console.log('🔎 Key field presence in actionables array:');
        const fields = ['theme', 'tranche3', 'new_product', 'impact_dropdown', 'product_live_date', 'task_status', 'actionable_issue'];
        fields.forEach(field => {
          const hasField = field in firstItem;
          console.log(`   • ${field}: ${hasField ? '✅' : '❌'}`);
        });
      }
    } else {
      console.log('❌ No "actionables" array found in document!');
      console.log('Top-level fields:', Object.keys(sample).slice(0, 10).join(', '));
    }

    // Count items across all documents
    console.log('\n📊 Total actionable items across all docs:');
    const allDocs = await collection.find({}).toArray();
    let totalItems = 0;
    for (const doc of allDocs) {
      if (doc.actionables && Array.isArray(doc.actionables)) {
        console.log(`   • ${doc.doc_id}: ${doc.actionables.length} items`);
        totalItems += doc.actionables.length;
      }
    }
    console.log(`\n   TOTAL: ${totalItems} actionable items`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.close();
  }
}

inspectDocumentStructure();
