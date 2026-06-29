import * as cp from 'child_process';
import * as vscode from 'vscode';

function exec(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.exec(command, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
  });
}

async function isOllamaInstalled(): Promise<boolean> {
  try {
    await exec('which ollama');
    return true;
  } catch {
    return false;
  }
}

async function isBrewInstalled(): Promise<boolean> {
  try {
    await exec('which brew');
    return true;
  } catch {
    return false;
  }
}

function installCommand(): string | null {
  switch (process.platform) {
    case 'darwin':
      return 'brew install ollama';
    case 'linux':
      return 'curl -fsSL https://ollama.com/install.sh | sh';
    default:
      return null;
  }
}

async function isOllamaRunning(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function isModelPulled(baseUrl: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      return false;
    }
    const data = await res.json() as { models: { name: string }[] };
    return data.models.some(m => m.name.startsWith(model));
  } catch {
    return false;
  }
}

function runInTerminal(name: string, command: string): vscode.Terminal {
  const terminal = vscode.window.createTerminal(name);
  terminal.show();
  terminal.sendText(command);
  return terminal;
}

function poll(
  check: () => Promise<boolean>,
  intervalMs: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise(resolve => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (await check()) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, intervalMs);
  });
}

async function waitWithProgress<T>(
  title: string,
  task: Promise<T>
): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title },
    () => task
  );
}

export async function runSetupWizard(baseUrl: string, model: string): Promise<boolean> {
  // Step 1 — Ollama installed?
  let installed = await isOllamaInstalled();
  if (!installed) {
    const cmd = installCommand();

    if (!cmd) {
      const action = await vscode.window.showWarningMessage(
        'Copilot Memory: Ollama is not installed. Download it from ollama.com to enable semantic search.',
        'Open ollama.com',
        'Disable Feature'
      );
      if (action === 'Open ollama.com') {
        vscode.env.openExternal(vscode.Uri.parse('https://ollama.com'));
      } else if (action === 'Disable Feature') {
        await vscode.workspace.getConfiguration('copilotMemory').update(
          'semanticSearch.enabled', false, vscode.ConfigurationTarget.Global
        );
      }
      return false;
    }

    if (process.platform === 'darwin' && !await isBrewInstalled()) {
      const action = await vscode.window.showWarningMessage(
        'Copilot Memory: Homebrew is not installed. Install it first, or download Ollama from ollama.com.',
        'Open ollama.com',
        'Disable Feature'
      );
      if (action === 'Open ollama.com') {
        vscode.env.openExternal(vscode.Uri.parse('https://ollama.com'));
      } else if (action === 'Disable Feature') {
        await vscode.workspace.getConfiguration('copilotMemory').update(
          'semanticSearch.enabled', false, vscode.ConfigurationTarget.Global
        );
      }
      return false;
    }

    const action = await vscode.window.showWarningMessage(
      `Copilot Memory: Ollama is not installed. Install it now?`,
      'Install Now',
      'Disable Feature'
    );
    if (action === 'Disable Feature') {
      await vscode.workspace.getConfiguration('copilotMemory').update(
        'semanticSearch.enabled', false, vscode.ConfigurationTarget.Global
      );
      return false;
    }
    if (action !== 'Install Now') {
      return false;
    }

    // On macOS, brew services makes Ollama start on login automatically.
    // On Linux, the install script registers a systemd service.
    const installAndStart = process.platform === 'darwin'
      ? `${cmd} && brew services start ollama`
      : cmd;

    runInTerminal('Copilot Memory — Install Ollama', installAndStart);

    installed = await waitWithProgress(
      'Copilot Memory: Installing Ollama…',
      poll(isOllamaInstalled, 3000, 5 * 60 * 1000)
    );

    if (!installed) {
      vscode.window.showErrorMessage(
        'Copilot Memory: Ollama installation timed out. Check the terminal for errors.'
      );
      return false;
    }
  }

  // Step 2 — Ollama running?
  let running = await isOllamaRunning(baseUrl);
  if (!running) {
    const action = await vscode.window.showWarningMessage(
      'Copilot Memory: Ollama is installed but not running.',
      'Start Ollama',
      'Cancel'
    );
    if (action !== 'Start Ollama') {
      return false;
    }

    const startCmd = process.platform === 'darwin'
      ? 'brew services start ollama'
      : 'ollama serve';

    runInTerminal('Copilot Memory — Ollama', startCmd);

    running = await waitWithProgress(
      'Copilot Memory: Starting Ollama…',
      poll(() => isOllamaRunning(baseUrl), 1000, 15000)
    );

    if (!running) {
      vscode.window.showErrorMessage(
        'Copilot Memory: Ollama did not start in time. Try running "ollama serve" manually.'
      );
      return false;
    }
  }

  // Step 3 — Model pulled?
  let pulled = await isModelPulled(baseUrl, model);
  if (!pulled) {
    const action = await vscode.window.showInformationMessage(
      `Copilot Memory: Embedding model "${model}" is not installed (~275 MB).`,
      'Pull Now',
      'Cancel'
    );
    if (action !== 'Pull Now') {
      return false;
    }

    runInTerminal('Copilot Memory — Pull Model', `ollama pull ${model}`);

    pulled = await waitWithProgress(
      `Copilot Memory: Pulling "${model}"… (this may take a few minutes)`,
      poll(() => isModelPulled(baseUrl, model), 5000, 10 * 60 * 1000)
    );

    if (!pulled) {
      vscode.window.showErrorMessage(
        `Copilot Memory: Model pull timed out. Check the terminal for errors.`
      );
      return false;
    }
  }

  vscode.window.showInformationMessage(
    `Copilot Memory: Ollama ready. Semantic search active using "${model}".`
  );
  return true;
}
