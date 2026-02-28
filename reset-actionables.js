const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Global Actionable Status Reset
 *
 * Resets task_status to "assigned" for every ActionableItem nested inside
 * every ActionablesResult document in the 'actionables' collection.
 *
 * Structure:
 *   Collection: actionables
 *   Document:   { _id: <doc_id>, actionables: [ { task_status, ... }, ... ], ... }
 *
 * Workflow-state fields reset per item:
 *   task_status, submitted_at, completion_date, reviewer_comments,
 *   team_reviewer_name, team_reviewer_approved_at, team_reviewer_rejected_at,
 *   is_delayed, delay_detected_at, justification, justification_by,
 *   justification_at
 *
 * Fields NOT touched: evidence_files, comments, delay_chat, audit_trail,
 *   and all extraction/metadata fields.
 */

async function resetActionables() {
    const uri = "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');

        const db = client.db('govinda_v2');

        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        console.log('Collections:', collectionNames);

        if (!collectionNames.includes('actionables')) {
            console.error('ERROR: "actionables" collection not found.');
            return;
        }

        const col = db.collection('actionables');

        // Count total items before reset
        const allDocs = await col.find({}).toArray();
        console.log(`\nFound ${allDocs.length} ActionablesResult documents.`);

        let totalItems = 0;
        let totalModified = 0;

        for (const doc of allDocs) {
            const items = doc.actionables || [];
            totalItems += items.length;

            // Build the updated items array — only reset workflow-state fields
            const updatedItems = items.map(item => ({
                ...item,
                task_status:                  "assigned",
                submitted_at:                 "",
                completion_date:              "",
                reviewer_comments:            "",
                team_reviewer_name:           "",
                team_reviewer_approved_at:    "",
                team_reviewer_rejected_at:    "",
                is_delayed:                   false,
                delay_detected_at:            "",
                justification:                "",
                justification_by:             "",
                justification_at:             "",
            }));

            const result = await col.updateOne(
                { _id: doc._id },
                { $set: { actionables: updatedItems } }
            );

            if (result.modifiedCount > 0) {
                totalModified += items.length;
                console.log(`  ✓ doc_id=${doc._id || doc.doc_id}  items reset: ${items.length}`);
            } else {
                console.log(`  – doc_id=${doc._id || doc.doc_id}  no change (already clean)`);
            }
        }

        console.log(`\n✅ Reset complete.`);
        console.log(`   Documents processed : ${allDocs.length}`);
        console.log(`   Total items reset   : ${totalModified} / ${totalItems}`);

        // Verify: collect all task_status values post-reset
        const verifyDocs = await col.find({}).toArray();
        const statusCounts = {};
        for (const doc of verifyDocs) {
            for (const item of (doc.actionables || [])) {
                const s = item.task_status || '(empty)';
                statusCounts[s] = (statusCounts[s] || 0) + 1;
            }
        }

        console.log('\nStatus distribution after reset:');
        Object.entries(statusCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([status, count]) => console.log(`  ${status}: ${count}`));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nConnection closed');
    }
}

resetActionables();
