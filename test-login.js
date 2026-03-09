const fetch = require('node-fetch');

async function testLogin(email, password) {
  console.log(`\nTesting: ${email} / ${password}`);
  const res = await fetch('http://localhost:3000/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const text = await res.text();
  console.log(`  Status: ${res.status}`);
  try {
    const json = JSON.parse(text);
    if (json.user) {
      console.log(`  User: ${json.user.name} | Role: ${json.user.role} | Team: ${json.user.team}`);
    } else if (json.code) {
      console.log(`  Error: ${json.code} - ${json.message}`);
    }
  } catch {
    console.log(`  Body: ${text.substring(0, 200)}`);
  }
  return res.status;
}

async function run() {
  console.log('=== LOGIN TESTS ===\n');

  // Test compliance officer
  const s1 = await testLogin('compliance.officer.compliance.redtech@redtech.com', 'RedTech@2026');

  // Test admin
  const s2 = await testLogin('admin.officer.admin.redtech@redtech.com', 'RedTech@2026');

  // Test a chief
  const s3 = await testLogin('engineering.chief.engineering.redtech@redtech.com', 'RedTech@2026');

  // Test a team member
  const s4 = await testLogin('engineering.division.1.unit.1.member.engineering_division_1_unit_1.redtech@redtech.com', 'RedTech@2026');

  // Test wrong password (should fail)
  const s5 = await testLogin('compliance.officer.compliance.redtech@redtech.com', 'WrongPassword123');

  console.log('\n=== SUMMARY ===');
  console.log(`Compliance Officer: ${s1 === 200 ? 'PASS' : 'FAIL'} (${s1})`);
  console.log(`Admin: ${s2 === 200 ? 'PASS' : 'FAIL'} (${s2})`);
  console.log(`Chief: ${s3 === 200 ? 'PASS' : 'FAIL'} (${s3})`);
  console.log(`Team Member: ${s4 === 200 ? 'PASS' : 'FAIL'} (${s4})`);
  console.log(`Wrong Password: ${s5 === 401 ? 'PASS (correctly rejected)' : 'FAIL'} (${s5})`);
}

run().catch(err => {
  console.error('Request failed:', err);
  process.exit(1);
});
