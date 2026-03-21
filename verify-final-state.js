const { MongoClient } = require('./web/node_modules/mongodb');

async function verifyFinalState() {
  const mongoUri = process.env.MONGODB_URI || 
    "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db('govinda_v2');
    const collection = db.collection('actionables');

    // 1. Count documents
    const docCount = await collection.countDocuments();
    console.log(`📊 Total items in collection: ${docCount}`);

    // 2. Get all document IDs
    const allDocs = await collection.find({}, { projection: { doc_id: 1 } }).toArray();
    const docIds = [...new Set(allDocs.map(d => d.doc_id))];
    console.log(`📄 Document IDs present (${docIds.length}):`);
    docIds.forEach(id => console.log(`   • ${id}`));

    // 3. Verify 3 canonical docs exist
    const expectedDocs = ['DOC-TEST-001', 'DOC-SYN-Market-Risk', 'DOC-SYN-Audit'];
    const hasAllExpected = expectedDocs.every(doc => docIds.includes(doc));
    console.log(`\n✓ Has all 3 canonical docs: ${hasAllExpected ? '✅ YES' : '❌ NO'}`);

    // 4. Count items per doc
    console.log(`\n📋 Items per document:`);
    for (const docId of expectedDocs) {
      const count = await collection.countDocuments({ doc_id: docId });
      console.log(`   • ${docId}: ${count} items`);
    }

    // 5. Sample items to verify schema
    const sample = await collection.findOne({});
    if (sample) {
      console.log(`\n🔍 Sample item schema check:`);
      const fields = ['theme', 'tranche3', 'new_product', 'impact_dropdown', 'product_live_date'];
      fields.forEach(field => {
        const hasField = field in sample;
        const value = sample[field];
        console.log(`   • ${field}: ${hasField ? '✅' : '❌'} (value: ${JSON.stringify(value)})`);
      });
    }

    // 6. Check for missing fields across all items
    console.log(`\n📈 Field coverage across all items:`);
    const fieldCounts = {};
    for (const field of ['theme', 'tranche3', 'new_product', 'impact_dropdown']) {
      const count = await collection.countDocuments({ [field]: { $exists: true } });
      const percentage = ((count / docCount) * 100).toFixed(1);
      fieldCounts[field] = { count, percentage };
      console.log(`   • ${field}: ${count}/${docCount} (${percentage}%)`);
    }

    // 7. Verify no excess documents exist
    const excessCount = await collection.countDocuments({
      doc_id: { $nin: expectedDocs }
    });
    console.log(`\n🧹 Excess documents (should be 0): ${excessCount}`);
    
    if (excessCount > 0) {
      const excess = await collection.distinct('doc_id', {
        doc_id: { $nin: expectedDocs }
      });
      console.log(`   Excess doc IDs: ${excess.join(', ')}`);
    }

    console.log(`\n✅ Verification complete - database is ${excessCount === 0 ? 'CLEAN ✓' : 'NEEDS CLEANUP ✗'}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.close();
  }
}

verifyFinalState();
