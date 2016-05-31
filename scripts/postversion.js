import {exec} from 'child_process';
import fs from 'fs';
import path from 'path';

/* eslint no-console: 0 */

/**
 * Determines whether or not the project has the Bower setup by checking for
 * the presence of a bower.json file.
 *
 * @return {Boolean}
 */
const hasBower = () => {
  try {
    fs.statSync(path.join(__dirname, '../bower.json'));
    return true;
  } catch (x) {
    return false;
  }
};

// If the project supports Bower, roll HEAD back one commit to avoid having
// the tagged commit - with `dist/` - in the main history.
if (hasBower()) {
  exec('git reset --hard HEAD~1', (err, stdout, stderr) => {
    if (err) {
      process.stdout.write(err.stack);
      process.exit(err.status || 1);
    } else {
      process.stdout.write(stdout);
    }
  });
}
