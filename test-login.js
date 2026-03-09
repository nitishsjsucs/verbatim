const fetch = require('node-fetch');

async function run() {
  const res = await fetch('http://localhost:3000/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'compliance_officer@redtech.com',
      password: 'Govinda123'
    })
  });

  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Body:', text);
}

run().catch(err => {
  console.error('Request failed:', err);
  process.exit(1);
});
