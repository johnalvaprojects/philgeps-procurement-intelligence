import readline from 'node:readline';
import { createFirstStaff } from './store.js';
import { passwordError, usernameError } from './validation.js';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      reject(new Error('Create the staff account from an interactive terminal.'));
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    if (hidden) {
      rl.stdoutMuted = true;
      const original = rl._writeToOutput.bind(rl);
      let prompted = false;
      rl._writeToOutput = function writeMuted(stringToWrite) {
        if (!prompted) {
          prompted = true;
          original(stringToWrite);
          return;
        }
        if (rl.stdoutMuted) return;
        original(stringToWrite);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

export async function runCreateStaff({ directory } = {}) {
  const username = await ask('Username: ');
  const nameError = usernameError(username);
  if (nameError) throw new Error(nameError);

  const password = await ask('Password: ', { hidden: true });
  const secretError = passwordError(password, username);
  if (secretError) throw new Error(secretError);

  const confirmation = await ask('Confirm password: ', { hidden: true });
  if (password !== confirmation) throw new Error('The passwords did not match.');

  const account = await createFirstStaff({ directory, username, password });
  return account;
}
