const { MongoClient } = require('./web/node_modules/mongodb');

const DEFAULT_URI = process.env.MONGO_URI || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || 'govinda_v2';

(async () => {
  const client = new MongoClient(DEFAULT_URI);
  try {
    await client.connect();
    const db = client.db(DEFAULT_DB);
    const col = db.collection('actionables');

    const allDocs = await col.find({}).project({_id:1, doc_id:1, actionables:1}).toArray();
    console.log(`Found ${allDocs.length} documents in 'actionables' collection`);
    allDocs.forEach(d => console.log(` - ${d._id || d.doc_id} (${(d.actionables||[]).length} items)`));

    const doc = await col.findOne({_id: 'DOC-TEST-001'});
    if (!doc) {
      console.log('DOC-TEST-001 not found');
      return;
    }
    const items = doc.actionables || [];
    console.log(`\nDOC-TEST-001: ${items.length} items`);

    // new_product distribution
    const byNew = {};
    items.forEach(it => {
      const key = (it.new_product === undefined || it.new_product === null) ? 'undefined' : String(it.new_product);
      byNew[key] = (byNew[key] || 0) + 1;
    });
    console.log('\nBy new_product:');
    Object.entries(byNew).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

    // Items where workstream or assigned_teams mention 'test' or 'head'
    const regex = /test|head/i;
    const matched = items.map((it, idx) => ({idx, id: it.actionable_id || it.id || `(idx:${idx})`, workstream: it.workstream || '', assigned: (it.assigned_teams||[]).join(', '), new_product: it.new_product, task_status: it.task_status, approval_status: it.approval_status})).filter(x => regex.test(`${x.workstream} ${x.assigned}`));
    console.log(`\nItems with 'test' or 'head' in workstream/assigned: ${matched.length}`);
    matched.slice(0,50).forEach(m => console.log(`  - ${m.id} | workstream: ${m.workstream} | assigned: ${m.assigned} | new_product: ${m.new_product} | status: ${m.task_status}`));

    // Items with new_product === 'Yes'
    const newYes = items.filter(it => it.new_product === 'Yes' || it.new_product === true || String(it.new_product).toLowerCase() === 'yes');
    console.log(`\nnew_product === 'Yes' count: ${newYes.length}`);
    newYes.slice(0,50).forEach((it, i) => console.log(`  ${i+1}. ${it.actionable_id || it.id || it.action} | workstream: ${it.workstream || ''} | assigned: ${(it.assigned_teams||[]).join(', ')} | status: ${it.task_status || ''}`));

    // Completed / approved counts
    const completed = items.filter(it => it.task_status && /completed|done/i.test(it.task_status)).length;
    const approved = items.filter(it => it.approval_status && /approved/i.test(String(it.approval_status))).length;
    console.log(`\nCompleted (task_status completed/done): ${completed}`);
    console.log(`Approval_status approved: ${approved}`);

    // Print any items that are completed and new_product
    const completedNew = items.filter(it => (it.task_status && /completed|done/i.test(it.task_status)) && (it.new_product === 'Yes' || String(it.new_product).toLowerCase() === 'yes'));
    console.log(`\nCompleted & new_product==='Yes': ${completedNew.length}`);
    completedNew.slice(0,20).forEach(it => console.log(`  - ${it.actionable_id || it.id || it.action} | status:${it.task_status} | assigned:${(it.assigned_teams||[]).join(', ')}`));

    // Teams containing 'Test' (from teams collection)
    const teams = await db.collection('teams').find({}).project({name:1, depth:1}).toArray();
    const testTeams = teams.filter(t => /test/i.test(t.name));
    console.log('\nTeams with "test" in name:');
    testTeams.forEach(t => console.log(`  - ${t.name} (depth: ${t.depth})`));

  } catch (err) {
    console.error('Error during inspection:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
