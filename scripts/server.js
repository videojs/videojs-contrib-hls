import connect from 'connect';
import cowsay from 'cowsay';
import path from 'path';
import portscanner from 'portscanner';
import serveStatic from 'serve-static';

// Configuration for the server.
const PORT = 9999;
const MAX_PORT = PORT + 100;
const HOST = '127.0.0.1';

const app = connect();

const verbs = [
  'Chewing the cud',
  'Grazing',
  'Mooing',
  'Lowing',
  'Churning the cream'
];

app.use(serveStatic(path.join(__dirname, '..')));

portscanner.findAPortNotInUse(PORT, MAX_PORT, HOST, (error, port) => {
  if (error) {
    throw error;
  }

  process.stdout.write(cowsay.say({
    text: `${verbs[Math.floor(Math.random() * 5)]} on ${HOST}:${port}`
  }) + '\n\n');

  app.listen(port);
});
