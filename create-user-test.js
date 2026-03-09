const fetch = require('node-fetch');

async function run() {
  const body = {
    name: 'Temp Compliance',
    role: 'compliance_officer',
    team: 'Compliance'
  };

  const res = await fetch('http://localhost:3000/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Body:', text);
}

run().catch(err => {
  console.error('Request failed:', err);
  process.exit(1);
});
