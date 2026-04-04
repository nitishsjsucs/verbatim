const { MongoClient } = require('./web/node_modules/mongodb');

const DEFAULT_URI = process.env.MONGO_URI || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || 'govinda_v2';

(async () => {
  const client = new MongoClient(DEFAULT_URI);
  try {
    await client.connect();
    const db = client.db(DEFAULT_DB);
    const col = db.collection('testing_items');

    const total = await col.countDocuments();
    console.log(`Total testing_items: ${total}`);

    const bySection = await col.aggregate([
      { $group: { _id: "$testing_section", count: { $sum: 1 } } }
    ]).toArray();
    console.log('By testing_section:');
    bySection.forEach(b => console.log(`  ${b._id}: ${b.count}`));

    const productItems = await col.find({ testing_section: 'product' }).toArray();
    console.log(`\nProduct section items: ${productItems.length}`);
    productItems.slice(0,50).forEach((it, idx) => {
      console.log(`${idx+1}. id:${it.id || it._id} | src:${it.source_actionable_id || it.source_actionable_id} | doc:${it.source_doc_id} | src_new_product:${it.source_new_product} | status:${it.status} | assigned_tester:${it.assigned_tester_name} | assigned_maker:${it.assigned_maker_name} | created_at:${it.created_at}`);
    });

    const productFromNew = await col.countDocuments({ testing_section: 'product', source_new_product: { $in: ['Yes', 'yes', true] } });
    console.log(`\nProduct items with source_new_product==='Yes': ${productFromNew}`);

    // Check items assigned to testing_head (role-level view depends on status). Look for items with status not pending
    const activeProduct = await col.countDocuments({ testing_section: 'product', status: { $nin: ['pending_assignment'] } });
    console.log(`Product items with status != pending_assignment: ${activeProduct}`);

  } catch (err) {
    console.error('Error inspecting testing_items:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
