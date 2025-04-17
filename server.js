import express from 'express';
import handler from './api/pdf-tool.js';
import formidable from 'formidable';

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  if (req.method === 'POST' && req.headers['content-type']?.startsWith('multipart/form-data')) {
    const form = formidable({ multiples: true });
    form.parse(req, (err, fields, files) => {
      req.body = fields;
      req.files = files;
      handler(req, res);
    });
  } else {
    next();
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
