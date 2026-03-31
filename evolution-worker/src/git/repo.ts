import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";

export class GitLibrary {
  private repoUrl: string;
  private localPath: string;

  constructor(repoUrl: string, localPath: string = "/tmp/sandboxed-library") {
    this.repoUrl = repoUrl;
    this.localPath = localPath;
  }

  /** Ensure the repository is cloned and up to date */
  sync(): string {
    if (!existsSync(this.localPath)) {
      mkdirSync(this.localPath, { recursive: true });
      execSync(`git clone ${this.repoUrl} .`, { cwd: this.localPath, stdio: "ignore" });
    } else {
      execSync(`git fetch --all && git reset --hard origin/main`, { cwd: this.localPath, stdio: "ignore" });
    }
    return this.localPath;
  }

  /** Commit all changes and push back to remote */
  commitAndPush(message: string): void {
    const status = execSync(`git status --porcelain`, { cwd: this.localPath }).toString();
    if (!status.trim()) {
      return; // No changes
    }

    execSync(`git add .`, { cwd: this.localPath, stdio: "ignore" });
    execSync(`git commit -m "${message}"`, { cwd: this.localPath, stdio: "ignore" });
    execSync(`git push origin main`, { cwd: this.localPath, stdio: "ignore" });
  }
}
