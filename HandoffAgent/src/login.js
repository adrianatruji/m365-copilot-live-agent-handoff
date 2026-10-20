// One-time sign-in so the HandoffAgent can call your Copilot Studio agent (see copilotStudioAuth.js).
const { signIn } = require('./copilotStudioAuth')

signIn()
  .then(user => console.log(`Signed in as ${user}. You can now run "npm start".`))
  .catch(err => { console.error(err.message); process.exit(1) })
