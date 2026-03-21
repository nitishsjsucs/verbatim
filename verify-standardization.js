const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('govinda_v2');
    const actionables = db.collection('ActionablesResult');
    
    // Count total documents
    const docCount = await actionables.countDocuments();
    console.log('✓ Total items:', docCount);
    
    // Get distinct doc_ids
    const docs = await actionables.distinct('doc_id');
    console.log('✓ Documents:', docs.sort());
    
    // Count items per document
    const itemsPerDoc = {};
    for (const docId of docs) {
      itemsPerDoc[docId] = await actionables.countDocuments({ doc_id: docId });
    }
    console.log('✓ Items per document:', itemsPerDoc);
    
    // Check for missing core fields
    const missingFields = await actionables.countDocuments({
      $or: [
        { theme: { $exists: false } },
        { tranche3: { $exists: false } },
        { new_product: { $exists: false } },
        { impact_dropdown: { $exists: false } }
      ]
    });
    console.log('✓ Items with missing core fields:', missingFields);
    
    // Verify impact_dropdown structure
    const sampleItems = await actionables.find({ doc_id: 'DOC-SYN-Market-Risk' }).limit(3).toArray();
    console.log('\n✓ Sample items from DOC-SYN-Market-Risk:');
    sampleItems.forEach((item, idx) => {
      console.log(`  [${idx}] impact_dropdown:`, JSON.stringify(item.impact_dropdown));
    });
    
    console.log('\n✅ Verification complete!');
  } finally {
    await client.close();
  }
})();
