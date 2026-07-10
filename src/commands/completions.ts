import { Command } from "commander";

const BASH_COMPLETIONS = `#!/bin/bash
# wtr bash completions
# Install: wtr completions bash >> ~/.bashrc
#   or:   wtr completions bash > /usr/local/etc/bash_completion.d/wtr

_wtr_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="init add list remove open status diff pr clean current cd exec each sync completions"

  case "\${prev}" in
    wtr)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      return 0
      ;;
    cd|exec|remove|rm|open|diff|pr|sync)
      local worktrees
      worktrees=$(wtr list --porcelain 2>/dev/null | awk -F'\\t' '{print $2}')
      COMPREPLY=( $(compgen -W "\${worktrees}" -- "\${cur}") )
      return 0
      ;;
    completions)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      return 0
      ;;
  esac

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "--json --help" -- "\${cur}") )
  fi
}

complete -F _wtr_completions wtr`;

const ZSH_COMPLETIONS = `#compdef wtr
# wtr zsh completions
# Install: wtr completions zsh > ~/.zfunc/_wtr
#   then add to .zshrc: fpath=(~/.zfunc $fpath) && autoload -Uz compinit && compinit

_wtr_worktrees() {
  local -a worktrees
  worktrees=(\${(f)"$(wtr list --porcelain 2>/dev/null | awk -F'\\t' '{print $2}')"})
  _describe 'worktree' worktrees
}

_wtr() {
  local -a commands
  commands=(
    'init:Initialize wtr for this repository'
    'add:Create a new worktree'
    'list:List all worktrees'
    'remove:Remove a worktree'
    'open:Open a worktree in a new terminal window'
    'status:Show enriched status of all worktrees'
    'diff:Show diff for a worktree'
    'pr:Create a pull request for a worktree'
    'clean:Remove stale entries and merged worktrees'
    'current:Show the current worktree'
    'cd:Print the path of a worktree'
    'exec:Run a command in a worktree directory'
    'each:Run a command in every worktree'
    'sync:Sync worktree(s) with the default branch'
    'completions:Generate shell completions'
  )

  _arguments -C \\
    '--no-color[Disable colored output]' \\
    '--version[Show version]' \\
    '--help[Show help]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        cd|exec|remove|rm|open|diff|pr|sync)
          _wtr_worktrees
          ;;
        add)
          _arguments \\
            '-b[Create new branch]' \\
            '-B[Create or reset branch]' \\
            '--base[Base ref]:ref' \\
            '--detach[Detached HEAD]' \\
            '--no-copy[Skip copying files]' \\
            '--no-bump[Skip port bumping]' \\
            '--open[Open terminal with Claude]' \\
            '--plan[Plan text]:text' \\
            '--plan-file[Plan file]:file:_files' \\
            '--model[Model for Claude session]:model' \\
            '--json[JSON output]'
          ;;
        completions)
          _values 'shell' bash zsh fish
          ;;
        *)
          _arguments '--json[JSON output]' '--help[Show help]'
          ;;
      esac
      ;;
  esac
}

_wtr`;

const FISH_COMPLETIONS = `# wtr fish completions
# Install: wtr completions fish > ~/.config/fish/completions/wtr.fish

set -l commands init add list remove open status diff pr clean current cd exec each sync completions

# Disable file completions by default
complete -c wtr -f

# Commands
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a init -d "Initialize wtr for this repository"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a add -d "Create a new worktree"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a list -d "List all worktrees"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a remove -d "Remove a worktree"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a open -d "Open a worktree in a new terminal window"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a status -d "Show enriched status of all worktrees"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a diff -d "Show diff for a worktree"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a pr -d "Create a pull request for a worktree"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a clean -d "Remove stale entries and merged worktrees"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a current -d "Show the current worktree"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a cd -d "Print the path of a worktree"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a exec -d "Run a command in a worktree directory"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a each -d "Run a command in every worktree"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a sync -d "Sync worktree(s) with the default branch"
complete -c wtr -n "not __fish_seen_subcommand_from $commands" -a completions -d "Generate shell completions"

# Dynamic worktree completions for relevant subcommands
function __wtr_worktrees
  wtr list --porcelain 2>/dev/null | awk -F'\\t' '{print $2}'
end

complete -c wtr -n "__fish_seen_subcommand_from cd exec remove open diff pr sync" -a "(__wtr_worktrees)"

# Completions subcommand
complete -c wtr -n "__fish_seen_subcommand_from completions" -a "bash zsh fish"

# Global options
complete -c wtr -l no-color -d "Disable colored output"
complete -c wtr -l json -d "Output as JSON"
complete -c wtr -l help -d "Show help"`;

export const completionsCommand = new Command("completions")
  .description("Generate shell completions")
  .argument("[shell]", "Shell type (bash, zsh, fish)")
  .action((shell: string | undefined) => {
    const detected = shell ?? detectShell();

    switch (detected) {
      case "bash":
        console.log(BASH_COMPLETIONS);
        break;
      case "zsh":
        console.log(ZSH_COMPLETIONS);
        break;
      case "fish":
        console.log(FISH_COMPLETIONS);
        break;
      default:
        console.error(`Unknown shell: ${detected}. Supported: bash, zsh, fish`);
        process.exit(1);
    }
  });

const detectShell = (): string => {
  const shell = process.env.SHELL ?? "";
  if (shell.endsWith("/bash")) return "bash";
  if (shell.endsWith("/zsh")) return "zsh";
  if (shell.endsWith("/fish")) return "fish";
  return "zsh"; // Default to zsh on macOS
};
