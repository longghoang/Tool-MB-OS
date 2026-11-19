const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const crypto = require('crypto');
const { router: workspaceRoutes, restoreRememberedUser, requireUser, moduleAccess } = require('./routes/workspace');

const app = express();
app.set('view engine', 'ejs');
app.set('trust proxy', 'loopback');
app.use(bodyParser.urlencoded({ extended: true, limit: '35mb' }));
app.use(bodyParser.json({ limit: '35mb' }));
app.use(session({
  name: 'vncs.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
app.use(restoreRememberedUser);

app.use(workspaceRoutes);
app.use(requireUser);
app.use(moduleAccess);

app.use(require('./routes/pycTransition'));
app.use('/aes', require('./routes/aes.route'));
app.use('/manday', require('./routes/manday'));
app.use('/ai-checklist', require('./routes/ai-checklist'));
app.use('/pentest-report', require('./routes/pentest-report'));
app.use('/scope-review', require('./routes/scope-review'));
app.use('/pending-comment', require('./routes/pending-comment'));
app.use('/home', require('./routes/home.route'));
app.use('/excel', require('./routes/excel.route'));
app.get('/', (_req, res) => res.redirect('/home'));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, '127.0.0.1', () => console.log(`Tool running at http://127.0.0.1:${port}/home`));
}

module.exports = app;
