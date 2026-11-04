#!/usr/bin/env node

import { openSession, createSession } from './index.js';
import {
  getProjectDir as getProjectDirPath,
  getSessionPath as getSessionPathFull,
} from './paths.js';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
).version;

function resolvePath(path: string): string {
  if (path.startsWith('~')) {
    path = join(homedir(), path.slice(1));
  }
  return resolve(path);
}

function help() {
  console.log(`
cc-session v${VERSION}

Usage:
  cc-session create -p <project>                              Create new session
  cc-session add user "msg" -p <project> -s <id>           Add user message
  cc-session add assistant "msg" -p <project> -s <id>     Add assistant message
  cc-session read -p <project> -s <id>                      Read session
  cc-session list -p <project>                               List sessions

Options:
  -p <path>    Project path (required)
  -s <id>      Session ID (required for add/read)
  -h           Show help

Examples:
  cc-session create -p /my/project
  cc-session add user "Hello!" -p /my/project -s abc123
  cc-session add assistant "Hi, how can I help?" -p /my/project -s abc123
`);
  process.exit(0);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) help();

  const options: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p') {
      if (i + 1 >= args.length) { console.error('-p requires a value'); process.exit(1); }
      options.projectPath = args[++i];
    } else if (arg === '-s') {
      if (i + 1 >= args.length) { console.error('-s requires a value'); process.exit(1); }
      options.sessionId = args[++i];
    } else if (arg === '-h' || arg === '--help') {
      help();
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0], args: positional.slice(1), options };
}

function getProject(options: Record<string, string>): string {
  if (!options.projectPath) {
    console.error('Error: -p <project> is required');
    process.exit(1);
  }
  return resolvePath(options.projectPath);
}

function formatMessage(msg: any): string {
  if (msg.type === 'user') {
    return `[User]\n${msg.message.content}`;
  }
  const text = msg.message.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
  return `[Assistant]\n${text || '(no text)'}`;
}

function main() {
  const { command, args, options } = parseArgs();

  try {
    switch (command) {
      case 'create': {
        const projectPath = getProject(options);
        const session = createSession({ projectPath });
        session.save();
        console.log(session.sessionId);
        break;
      }

      case 'add': {
        const type = args[0];
        const message = args[1];

        if (!type || !['user', 'assistant'].includes(type)) {
          console.error('Usage: add <user|assistant> <message> -p <project> -s <id>');
          process.exit(1);
        }
        if (!message) {
          console.error('Message required');
          process.exit(1);
        }
        if (!options.sessionId) {
          console.error('-s <sessionId> required');
          process.exit(1);
        }

        const projectPath = getProject(options);

        let session;
        try {
          session = openSession({ sessionId: options.sessionId, projectPath });
        } catch {
          // Session doesn't exist yet, create with the specified ID
          session = createSession({ sessionId: options.sessionId, projectPath });
        }

        if (type === 'user') {
          session.addUserMessage(message);
        } else {
          session.addAssistantMessage([{ type: 'text', text: message }]);
        }
        session.save();

        console.log(`Added ${type} message (${session.messages.length} total)`);
        break;
      }

      case 'read': {
        if (!options.sessionId) {
          console.error('-s <sessionId> required');
          process.exit(1);
        }
        const projectPath = getProject(options);

        const session = openSession({ sessionId: options.sessionId, projectPath });

        for (const msg of session.messages) {
          console.log(formatMessage(msg));
          console.log('');
        }
        break;
      }

      case 'list': {
        const projectPath = getProject(options);
        const dir = getProjectDirPath(projectPath);

        try {
          const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
          if (files.length === 0) {
            console.log('No sessions');
          } else {
            for (const file of files.sort().reverse()) {
              console.log(file.replace('.jsonl', ''));
            }
          }
        } catch {
          console.log('No sessions');
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        help();
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
