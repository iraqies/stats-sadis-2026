// Copy or symlink the SQLite database into the webapp directory
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'students.db')
const dst = path.join(__dirname, 'students.db')

if (fs.existsSync(src) && !fs.existsSync(dst)) {
  try {
    fs.copyFileSync(src, dst)
    console.log('Copied students.db to webapp/')
  } catch (e) {
    console.error('Could not copy students.db:', e.message)
  }
}
