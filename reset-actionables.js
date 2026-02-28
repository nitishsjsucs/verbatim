const { MongoClient } = require('./web/node_modules/mongodb');

async function resetActionables() {
    const uri = "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');
        
        const db = client.db('govinda_v2');
        
        // Check collections
        const collections = await db.listCollections().toArray();
        console.log('Collections:', collections.map(c => c.name));
        
        // Find the actionable collection (might be 'actionables' or 'actionable_items')
        let actionableCollection = null;
        if (collections.some(c => c.name === 'actionables')) {
            actionableCollection = db.collection('actionables');
        } else if (collections.some(c => c.name === 'actionable_items')) {
            actionableCollection = db.collection('actionable_items');
        } else {
            console.log('No actionables collection found. Available collections:', collections.map(c => c.name));
            return;
        }
        
        // Get a sample document to understand the structure
        const sample = await actionableCollection.findOne();
        console.log('Sample document structure:', JSON.stringify(sample, null, 2));
        
        // Reset all actionables to "assigned" status
        const result = await actionableCollection.updateMany(
            {}, // Match all documents
            { 
                $set: { 
                    task_status: "assigned",
                    team_reviewer_approved_at: null,
                    team_reviewer_rejected_at: null,
                    team_reviewer_name: null,
                    approved_at: null,
                    rejected_at: null,
                    completed_at: null
                }
            }
        );
        
        console.log(`\n✅ Reset ${result.modifiedCount} actionables to "assigned" status`);
        
        // Verify the reset
        const statusCounts = await actionableCollection.aggregate([
            { $group: { _id: "$task_status", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();
        
        console.log('\nStatus counts after reset:');
        statusCounts.forEach(item => {
            console.log(`- ${item._id}: ${item.count}`);
        });
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nConnection closed');
    }
}

resetActionables();
