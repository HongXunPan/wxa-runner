import { execFile } from 'child_process';

const MAX_OUTPUT = 512 * 1024 * 1024;

export function runCompiler(bin: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, maxBuffer: MAX_OUTPUT, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || stdout || error.message).trim();
        reject(new Error(`${bin.split(/[\\/]/).pop()} 编译失败：\n${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}
