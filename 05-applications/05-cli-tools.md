# CLI Tools in Go

## What Is This?

A CLI (Command-Line Interface) tool is a program that accepts commands, flags, and arguments from a terminal and produces text output. Go is exceptionally well-suited for CLI tools: it compiles to a single static binary with no runtime dependency, starts in milliseconds, and produces cross-platform binaries from a single `go build` command. The standard library's `flag` package handles simple cases, while Cobra (the dominant third-party library) handles complex multi-command CLIs.

## Why Does It Exist?

Web UIs take weeks to build and require a browser. CLI tools can be written in hours, distributed as a single binary, scripted, piped, and automated. DevOps engineers, platform teams, and developers rely on CLI tools for infrastructure management, data processing, and developer experience. Before Go, CLI tools in C required complex build systems; in Python/Ruby/Node, they required installing runtimes and managing dependencies. Go's single-binary output solved the distribution problem permanently: `scp binary server:` and it runs.

## Who Uses This in Industry?

- **Google**: The `kubectl` Kubernetes CLI (Google-originated) is written in Go with Cobra. It handles hundreds of sub-commands (`kubectl get pods`, `kubectl apply -f`, `kubectl exec`) and is installed on millions of developer machines. Every Kubernetes operator writes `kubectl` plugins in Go.
- **Uber**: Uber's internal developer platform (uDevX) exposes tooling via Go CLIs. Their service scaffolding tool generates new microservices from templates via a Cobra-based CLI. Engineers run it hundreds of times per day.
- **Cloudflare**: The `cloudflared` tunnel daemon and the `flarectl` API CLI are both Go binaries. `flarectl zone list` and `flarectl dns create` are how ops teams manage 20M+ DNS records programmatically.
- **Docker**: The `docker` and `docker-compose` CLIs are Go+Cobra. Every developer who uses containers uses these CLIs. Docker's decision to use Go for the CLI enabled the single-binary distribution that made Docker adoption viral.
- **HashiCorp (Terraform, Vault, Consul)**: Every HashiCorp CLI tool is Go + Cobra. `terraform apply`, `vault token create`, `consul kv get` — all Cobra CLIs. HashiCorp's Go CLI standards are so well-established they published a `cli` library that powers them all.

## Industry Standards & Best Practices

**What senior Go engineers do:**
- Use Cobra for any CLI with more than 2-3 subcommands
- Separate CLI concerns (parsing flags, printing output) from business logic (which is tested independently)
- Use Viper for configuration that comes from flags + env vars + config files + defaults (in precedence order)
- Return exit code 1 for errors, 0 for success — never `log.Fatal` in library code, only in `main()`
- Write to `os.Stderr` for errors and progress, `os.Stdout` for data output (for piping)
- Support `--output json` / `--output table` for machine-readable output
- Use `--dry-run` flags for destructive operations
- Implement `--help` and `--version` as first-class features
- Test CLI commands via `cobra.Command.Execute()` with injected `io.Writer` — not by running subprocesses

**What beginners do:**
- Put all logic in `main()` — untestable
- Use `os.Exit()` inside library functions — panics deferred functions
- Ignore pipe detection: always print ANSI colors even when output is redirected to a file
- Parse flags manually with `os.Args` for complex CLIs — error-prone
- Mix `fmt.Println` (stdout) and `log.Printf` (stderr) inconsistently

## Why Go's Approach Is Unique

Go produces statically-linked, self-contained binaries. There is no pip install, no npm install, no gem install. The user downloads one file and it works. This is uniquely powerful for CLI tools:

| Aspect | Go | Python | Node.js | Rust |
|--------|----|----|--------|------|
| Distribution | Single binary, no runtime | Needs Python + pip | Needs Node.js + npm | Single binary (similar) |
| Startup time | ~5ms | ~100ms (PyPy: ~50ms) | ~200ms | ~3ms |
| Cross-compilation | `GOOS=linux GOARCH=amd64 go build` | Needs PyInstaller | pkg, nexe (complex) | `cross` tool (complex) |
| Memory | ~10MB baseline | ~30MB | ~50MB | ~5MB |
| Concurrency in CLI | Trivial goroutines | GIL limits | Event loop | Complex ownership |
| Binary size | 5-15MB (static) | N/A | N/A | 2-10MB (smaller with LTO) |

Go's key tradeoff vs. Rust: Go CLI tools are faster to write (garbage collection, simpler ownership), while Rust CLI tools are slightly smaller and faster at startup. For most CLIs, the development speed difference matters more than 2ms of startup time.

---

## Part 1: The Standard Library — os.Args and flag

### Why start with the standard library

Understanding `os.Args` and `flag` first gives you insight into what Cobra wraps. The standard library is appropriate for simple tools with a single command and a few flags. For anything with subcommands, use Cobra.

```go
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"strings"
)

// --- Example 1: os.Args — raw command-line access ---
// os.Args[0] is the program name
// os.Args[1:] are the arguments

func echoArgs() {
	fmt.Printf("Program: %s\n", os.Args[0])
	for i, arg := range os.Args[1:] {
		fmt.Printf("  arg[%d]: %s\n", i, arg)
	}
}

// --- Example 2: flag package — typed flags ---
// flag handles -flag, --flag, -flag=value, --flag value formats

func main() {
	// Define flags with their name, default value, and usage string
	host := flag.String("host", "localhost", "server hostname or IP")
	port := flag.Int("port", 8080, "server port number")
	verbose := flag.Bool("verbose", false, "enable verbose output")
	timeout := flag.Duration("timeout", 30e9, "connection timeout (e.g. 30s, 1m)")
	output := flag.String("output", "table", "output format: table|json|csv")

	// Customize usage message
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s [options] [files...]\n\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "Options:\n")
		flag.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\nExamples:\n")
		fmt.Fprintf(os.Stderr, "  %s --host=api.example.com --port=443 --verbose\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s --output=json data.txt\n", os.Args[0])
	}

	// Parse flags from os.Args[1:]
	flag.Parse()

	// flag.Args() returns non-flag arguments (positional args)
	positionalArgs := flag.Args()

	if *verbose {
		fmt.Fprintf(os.Stderr, "Config: host=%s port=%d timeout=%v output=%s\n",
			*host, *port, *timeout, *output)
	}

	// --- Detect if stdin is a pipe ---
	// When output is redirected (e.g., `./tool | grep`), don't print ANSI colors
	stat, _ := os.Stdin.Stat()
	isPiped := (stat.Mode() & os.ModeCharDevice) == 0

	if isPiped {
		// Reading from pipe: process line by line
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			line := scanner.Text()
			// Process line: write results to stdout for downstream pipe
			fmt.Println(strings.ToUpper(line))
		}
		if err := scanner.Err(); err != nil {
			fmt.Fprintf(os.Stderr, "error reading stdin: %v\n", err)
			os.Exit(1)
		}
	} else if len(positionalArgs) > 0 {
		// Process named files
		for _, file := range positionalArgs {
			fmt.Printf("Processing: %s\n", file)
		}
	} else {
		// No input — show help
		flag.Usage()
		os.Exit(1)
	}
}
```

**Common pitfalls:**
- Calling `flag.Parse()` more than once — parse once in `main()`, pass values as function arguments
- Using `flag.String()` return value before `flag.Parse()` — it's the zero value until parsing
- Printing to `os.Stdout` for error messages — errors go to `os.Stderr` so they can be separated in scripts

---

## Part 2: Cobra — Production CLI Framework

### Why Cobra: the subcommand problem

`flag` only handles a flat list of flags for a single command. Real CLIs have subcommand trees: `git commit -m "msg"`, `kubectl get pods -n default`, `docker run --rm ubuntu bash`. Building this with `flag` requires manual argument parsing. Cobra provides the structure.

```go
// File: main.go
package main

import (
	"os"

	"github.com/spf13/cobra"
)

func main() {
	if err := NewRootCmd().Execute(); err != nil {
		os.Exit(1)
	}
}
```

```go
// File: cmd/root.go
package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

// AppVersion is set at build time via -ldflags
var AppVersion = "dev"

// NewRootCmd creates the root command and registers all subcommands.
// The root command represents the binary itself (no subcommand given).
func NewRootCmd() *cobra.Command {
	var cfgFile string
	var verbose bool

	root := &cobra.Command{
		Use:   "apptool",
		Short: "A CLI tool for managing application resources",
		Long: `apptool manages application deployments, configurations, and monitoring.

Complete documentation: https://example.com/docs/apptool`,

		// SilenceUsage: true suppresses the usage message on error.
		// Without this, every error prints the full --help. Very noisy.
		SilenceUsage: true,

		// SilenceErrors: true prevents cobra from printing errors — we print them ourselves
		SilenceErrors: true,

		// PersistentPreRunE runs before every subcommand's Run function.
		// Good for: loading config, initializing logging, checking prerequisites.
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			if verbose {
				fmt.Fprintf(cmd.ErrOrStderr(), "verbose mode enabled\n")
			}
			// Could load config here:
			// return loadConfig(cfgFile)
			_ = cfgFile
			return nil
		},
	}

	// Persistent flags are available to this command AND all subcommands
	root.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "config file path")
	root.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")

	// Register subcommands
	root.AddCommand(
		newVersionCmd(),
		newGetCmd(),
		newCreateCmd(),
		newDeleteCmd(),
	)

	return root
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version information",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Fprintf(cmd.OutOrStdout(), "apptool version %s\n", AppVersion)
		},
	}
}
```

```go
// File: cmd/get.go
package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

type Resource struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	Namespace string `json:"namespace"`
	Age       string `json:"age"`
}

func newGetCmd() *cobra.Command {
	var namespace string
	var outputFormat string
	var allNamespaces bool

	get := &cobra.Command{
		Use:   "get [resource] [name]",
		Short: "Display one or many resources",
		Long: `Display one or many resources.

Examples:
  # List all pods in the current namespace
  apptool get pods

  # Get a specific service
  apptool get service my-service

  # List all pods across all namespaces
  apptool get pods --all-namespaces

  # Output as JSON
  apptool get pods --output json`,

		// Args validation: require at least one positional argument
		Args: cobra.MinimumNArgs(1),

		// RunE returns an error — Cobra handles printing it
		RunE: func(cmd *cobra.Command, args []string) error {
			resourceType := args[0]
			var resourceName string
			if len(args) > 1 {
				resourceName = args[1]
			}

			ns := namespace
			if allNamespaces {
				ns = ""
			}

			return runGet(cmd, resourceType, resourceName, ns, outputFormat)
		},
	}

	// Local flags: only for this command
	get.Flags().StringVarP(&namespace, "namespace", "n", "default", "namespace")
	get.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table|json|wide")
	get.Flags().BoolVar(&allNamespaces, "all-namespaces", false, "list across all namespaces")

	// Register valid completions for --output flag
	_ = get.RegisterFlagCompletionFunc("output", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"table", "json", "wide"}, cobra.ShellCompDirectiveNoFileComp
	})

	return get
}

func runGet(cmd *cobra.Command, resourceType, name, namespace, format string) error {
	// Simulated data — in real code, this calls your API/service
	resources := []Resource{
		{Name: "web-app", Status: "Running", Namespace: namespace, Age: "5d"},
		{Name: "api-server", Status: "Running", Namespace: namespace, Age: "2d"},
		{Name: "db-proxy", Status: "Pending", Namespace: namespace, Age: "1h"},
	}

	if name != "" {
		// Filter to specific resource
		for _, r := range resources {
			if r.Name == name {
				resources = []Resource{r}
				break
			}
		}
	}

	// Output to cmd.OutOrStdout() — NOT fmt.Println / os.Stdout
	// This allows test injection of a custom writer
	out := cmd.OutOrStdout()

	switch format {
	case "json":
		enc := json.NewEncoder(out)
		enc.SetIndent("", "  ")
		return enc.Encode(resources)

	case "wide", "table":
		// tabwriter for aligned table output
		w := tabwriter.NewWriter(out, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "NAME\tSTATUS\tNAMESPACE\tAGE")
		for _, r := range resources {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", r.Name, r.Status, r.Namespace, r.Age)
		}
		return w.Flush()

	default:
		return fmt.Errorf("unknown output format %q: use table, json, or wide", format)
	}

	_ = resourceType
	_ = os.Stdout // unused but shows intent
	return nil
}
```

```go
// File: cmd/create.go
package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newCreateCmd() *cobra.Command {
	var dryRun bool
	var labels []string

	create := &cobra.Command{
		Use:   "create NAME",
		Short: "Create a new resource",
		Args:  cobra.ExactArgs(1), // exactly one positional arg required

		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]

			if dryRun {
				fmt.Fprintf(cmd.OutOrStdout(), "[dry-run] would create resource: %s\n", name)
				return nil
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Created resource: %s\n", name)
			if len(labels) > 0 {
				fmt.Fprintf(cmd.OutOrStdout(), "Labels: %v\n", labels)
			}
			return nil
		},
	}

	create.Flags().BoolVar(&dryRun, "dry-run", false, "preview without making changes")
	create.Flags().StringArrayVarP(&labels, "label", "l", nil, "labels in key=value format (repeatable)")

	return create
}

func newDeleteCmd() *cobra.Command {
	var force bool
	var dryRun bool

	return &cobra.Command{
		Use:   "delete NAME",
		Short: "Delete a resource",
		Args:  cobra.ExactArgs(1),

		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]

			if !force && !dryRun {
				// Prompt for confirmation in interactive terminals
				fmt.Fprintf(cmd.OutOrStdout(), "Delete %q? This cannot be undone. [y/N]: ", name)
				var confirm string
				fmt.Fscan(cmd.InOrStdin(), &confirm)
				if confirm != "y" && confirm != "Y" {
					fmt.Fprintln(cmd.OutOrStdout(), "Cancelled.")
					return nil
				}
			}

			if dryRun {
				fmt.Fprintf(cmd.OutOrStdout(), "[dry-run] would delete: %s\n", name)
				return nil
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Deleted: %s\n", name)
			return nil
		},

		// Aliases: "del" and "rm" both work for this command
		Aliases: []string{"del", "rm"},
	}
}
```

---

## Part 3: Viper — Configuration Management

### Why Viper: the 12-factor config problem

The 12-Factor App standard says configuration should come from environment variables. But real applications need defaults, config files (for local dev), CLI flags (for one-off overrides), and remote config (Consul, etcd). Viper manages all four sources in a priority order: CLI flags > environment variables > config file > defaults.

```go
package main

import (
	"fmt"
	"log"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

// AppConfig is the typed configuration struct.
// After Viper loads all sources, we unmarshal into this.
type AppConfig struct {
	Server struct {
		Host    string `mapstructure:"host"`
		Port    int    `mapstructure:"port"`
		TLSCert string `mapstructure:"tls_cert"`
	} `mapstructure:"server"`

	Database struct {
		URL            string `mapstructure:"url"`
		MaxConnections int    `mapstructure:"max_connections"`
	} `mapstructure:"database"`

	LogLevel string `mapstructure:"log_level"`
	Debug    bool   `mapstructure:"debug"`
}

func setupViper(cfgFile string) error {
	// --- Set defaults (lowest priority) ---
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("database.max_connections", 25)
	viper.SetDefault("log_level", "info")
	viper.SetDefault("debug", false)

	// --- Config file (second priority) ---
	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	} else {
		// Search in common locations
		viper.SetConfigName("apptool") // file: apptool.yaml / apptool.json / apptool.toml
		viper.SetConfigType("yaml")
		viper.AddConfigPath(".")
		viper.AddConfigPath("$HOME/.apptool")
		viper.AddConfigPath("/etc/apptool")
	}

	if err := viper.ReadInConfig(); err != nil {
		// It's OK if config file doesn't exist
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return fmt.Errorf("read config: %w", err)
		}
	}

	// --- Environment variables (third priority) ---
	// APPTOOL_SERVER_HOST overrides server.host
	// APPTOOL_DATABASE_URL overrides database.url
	viper.SetEnvPrefix("APPTOOL")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv() // read env vars that match config keys

	return nil
}

func bindCobraFlags(cmd *cobra.Command) error {
	// Bind CLI flags to Viper keys (highest priority)
	// When the user passes --port=9090, viper.GetInt("server.port") returns 9090
	if err := viper.BindPFlag("server.host", cmd.Flags().Lookup("host")); err != nil {
		return err
	}
	if err := viper.BindPFlag("server.port", cmd.Flags().Lookup("port")); err != nil {
		return err
	}
	return nil
}

func loadConfig() (*AppConfig, error) {
	var cfg AppConfig
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	// Validate after loading
	if cfg.Server.Port < 1 || cfg.Server.Port > 65535 {
		return nil, fmt.Errorf("invalid port %d: must be 1-65535", cfg.Server.Port)
	}

	return &cfg, nil
}

func main() {
	var cfgFile string
	var host string
	var port int

	root := &cobra.Command{
		Use:          "apptool",
		SilenceUsage: true,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			if err := setupViper(cfgFile); err != nil {
				return err
			}
			return bindCobraFlags(cmd)
		},

		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadConfig()
			if err != nil {
				return err
			}

			fmt.Printf("Server: %s:%d\n", cfg.Server.Host, cfg.Server.Port)
			fmt.Printf("DB connections: %d\n", cfg.Database.MaxConnections)
			fmt.Printf("Log level: %s\n", cfg.LogLevel)
			fmt.Printf("Debug: %v\n", cfg.Debug)

			// Viper config source transparency
			if viper.IsSet("server.host") {
				fmt.Printf("Config file used: %s\n", viper.ConfigFileUsed())
			}

			return nil
		},
	}

	root.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "config file")
	root.Flags().StringVar(&host, "host", "", "server host (overrides config)")
	root.Flags().IntVar(&port, "port", 0, "server port (overrides config)")

	if err := root.Execute(); err != nil {
		log.Fatal(err)
	}
}
```

---

## Part 4: Progress Bars and Color Output

### Why visual feedback: UX for long-running CLI operations

A CLI tool that runs for 30 seconds with no output looks frozen. Users Ctrl+C it. Progress bars and color output are not cosmetic — they communicate state to the user, reducing support burden and increasing trust in the tool.

```go
package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// --- ANSI color codes ---
// Only use these when output is a terminal (not a pipe or file)

type Color string

const (
	ColorReset  Color = "\033[0m"
	ColorRed    Color = "\033[31m"
	ColorGreen  Color = "\033[32m"
	ColorYellow Color = "\033[33m"
	ColorBlue   Color = "\033[34m"
	ColorCyan   Color = "\033[36m"
	ColorBold   Color = "\033[1m"
)

// IsTerminal returns true if f is a terminal (not a pipe or file redirect)
func IsTerminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}

// Colorize wraps text in ANSI color codes, but ONLY if stdout is a terminal.
// Never emit ANSI codes to pipes — tools like grep and jq can't handle them.
func Colorize(text string, color Color) string {
	if !IsTerminal(os.Stdout) {
		return text // no color for pipes/files
	}
	return string(color) + text + string(ColorReset)
}

// --- Simple progress bar ---

type ProgressBar struct {
	total   int
	current int
	width   int
}

func NewProgressBar(total, width int) *ProgressBar {
	return &ProgressBar{total: total, width: width}
}

func (p *ProgressBar) Update(current int) {
	if !IsTerminal(os.Stdout) {
		return // no progress bars for piped output
	}

	p.current = current
	percent := float64(current) / float64(p.total)
	filled := int(percent * float64(p.width))
	empty := p.width - filled

	bar := "[" + strings.Repeat("=", filled) + strings.Repeat(" ", empty) + "]"

	// \r moves cursor to start of line without newline — overwrites previous bar
	fmt.Printf("\r%s %d/%d (%.0f%%)", bar, current, p.total, percent*100)

	if current >= p.total {
		fmt.Println() // newline when complete
	}
}

// --- Spinner for indeterminate progress ---

type Spinner struct {
	frames  []string
	current int
	message string
}

func NewSpinner(message string) *Spinner {
	return &Spinner{
		frames:  []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"},
		message: message,
	}
}

func (s *Spinner) Tick() {
	if !IsTerminal(os.Stdout) {
		return
	}
	frame := s.frames[s.current%len(s.frames)]
	fmt.Printf("\r%s %s", frame, s.message)
	s.current++
}

func (s *Spinner) Done(success bool) {
	if !IsTerminal(os.Stdout) {
		if success {
			fmt.Printf("%s: done\n", s.message)
		} else {
			fmt.Printf("%s: failed\n", s.message)
		}
		return
	}

	if success {
		fmt.Printf("\r%s %s\n", Colorize("✓", ColorGreen), s.message)
	} else {
		fmt.Printf("\r%s %s\n", Colorize("✗", ColorRed), s.message)
	}
}

// --- Status output helpers ---

func PrintSuccess(format string, args ...interface{}) {
	prefix := Colorize("✓", ColorGreen)
	fmt.Printf("%s %s\n", prefix, fmt.Sprintf(format, args...))
}

func PrintError(format string, args ...interface{}) {
	prefix := Colorize("✗", ColorRed)
	fmt.Fprintf(os.Stderr, "%s %s\n", prefix, fmt.Sprintf(format, args...))
}

func PrintWarning(format string, args ...interface{}) {
	prefix := Colorize("!", ColorYellow)
	fmt.Printf("%s %s\n", prefix, fmt.Sprintf(format, args...))
}

func PrintInfo(format string, args ...interface{}) {
	prefix := Colorize("→", ColorBlue)
	fmt.Printf("%s %s\n", prefix, fmt.Sprintf(format, args...))
}

func main() {
	// Progress bar demo
	fmt.Println("Downloading packages...")
	bar := NewProgressBar(100, 40)
	for i := 0; i <= 100; i++ {
		bar.Update(i)
		time.Sleep(20 * time.Millisecond)
	}

	// Spinner demo
	spinner := NewSpinner("Connecting to server...")
	for i := 0; i < 20; i++ {
		spinner.Tick()
		time.Sleep(100 * time.Millisecond)
	}
	spinner.Done(true)

	// Status messages
	PrintSuccess("Build completed: dist/apptool")
	PrintWarning("3 deprecated API calls found")
	PrintError("Failed to push to registry: connection refused")
	PrintInfo("Use --verbose for detailed output")

	// Color formatting
	fmt.Printf("Status: %s | %s | %s\n",
		Colorize("Running", ColorGreen),
		Colorize("Pending", ColorYellow),
		Colorize("Failed", ColorRed),
	)
}
```

---

## Part 5: Interactive Prompts

### Why interactive prompts: reducing human error in destructive operations

Commands like `delete`, `deploy`, and `format-disk` need confirmation. Typing `y` is a meaningful pause that prevents accidental data loss. For multi-step workflows, interactive prompts guide the user through choices without requiring them to memorize all flag names upfront.

```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Prompter wraps stdin/stdout for testable interactive prompts
type Prompter struct {
	in  *bufio.Reader
	out *os.File
}

func NewPrompter() *Prompter {
	return &Prompter{
		in:  bufio.NewReader(os.Stdin),
		out: os.Stdout,
	}
}

// Confirm asks a yes/no question. Returns true if the user confirms.
// defaultYes controls what happens when the user just presses Enter.
func (p *Prompter) Confirm(question string, defaultYes bool) bool {
	if !IsTerminal(os.Stdin) {
		// Non-interactive: default to safe (no) unless explicitly yes
		return defaultYes
	}

	prompt := "[y/N]"
	if defaultYes {
		prompt = "[Y/n]"
	}

	fmt.Fprintf(p.out, "%s %s: ", question, prompt)

	input, _ := p.in.ReadString('\n')
	input = strings.ToLower(strings.TrimSpace(input))

	switch input {
	case "y", "yes":
		return true
	case "n", "no":
		return false
	case "": // Enter pressed
		return defaultYes
	default:
		fmt.Fprintln(p.out, "Please enter y or n")
		return p.Confirm(question, defaultYes) // retry
	}
}

// Input prompts for a text value with an optional default.
func (p *Prompter) Input(prompt, defaultValue string) string {
	if defaultValue != "" {
		fmt.Fprintf(p.out, "%s [%s]: ", prompt, defaultValue)
	} else {
		fmt.Fprintf(p.out, "%s: ", prompt)
	}

	input, _ := p.in.ReadString('\n')
	input = strings.TrimSpace(input)

	if input == "" {
		return defaultValue
	}
	return input
}

// Select presents numbered options and returns the chosen option.
func (p *Prompter) Select(prompt string, options []string) (string, error) {
	fmt.Fprintf(p.out, "%s\n", prompt)
	for i, opt := range options {
		fmt.Fprintf(p.out, "  %d) %s\n", i+1, opt)
	}
	fmt.Fprintf(p.out, "Enter number [1-%d]: ", len(options))

	input, _ := p.in.ReadString('\n')
	input = strings.TrimSpace(input)

	n, err := strconv.Atoi(input)
	if err != nil || n < 1 || n > len(options) {
		return "", fmt.Errorf("invalid selection %q: enter a number between 1 and %d", input, len(options))
	}

	return options[n-1], nil
}

// IsTerminal reuses the function defined in the previous section
func IsTerminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}

func main() {
	p := NewPrompter()

	// Confirmation before destructive action
	if p.Confirm("Delete 42 resources in production?", false) {
		fmt.Println("Deleting...")
	} else {
		fmt.Println("Cancelled.")
		return
	}

	// Text input with default
	name := p.Input("Enter resource name", "my-app")
	fmt.Printf("Name: %s\n", name)

	// Selection from a list
	env, err := p.Select("Select deployment environment:", []string{"dev", "staging", "production"})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Selection error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Deploying to: %s\n", env)
}
```

---

## Part 6: Complete CLI Application

### A production-grade CLI tool: `vaultctl`

This example combines everything: Cobra, Viper, progress output, error handling, testable commands, and a complete `main.go`.

```go
// File: main.go
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var version = "0.1.0"

type GlobalOpts struct {
	ConfigFile string
	Output     string
	NoColor    bool
}

func main() {
	opts := &GlobalOpts{}

	root := &cobra.Command{
		Use:          "vaultctl",
		Short:        "CLI for managing secrets vault",
		Version:      version,
		SilenceUsage: true,
		SilenceErrors: true,

		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			return initConfig(opts)
		},
	}

	// Global persistent flags
	root.PersistentFlags().StringVarP(&opts.ConfigFile, "config", "c", "", "config file")
	root.PersistentFlags().StringVarP(&opts.Output, "output", "o", "table", "output format: table|json|yaml")
	root.PersistentFlags().BoolVar(&opts.NoColor, "no-color", false, "disable color output")

	// Add subcommands
	root.AddCommand(
		newSecretsCmd(opts),
		newAuditCmd(opts),
		newConfigCmd(opts),
	)

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}

func initConfig(opts *GlobalOpts) error {
	if opts.ConfigFile != "" {
		viper.SetConfigFile(opts.ConfigFile)
	} else {
		viper.SetConfigName("vaultctl")
		viper.SetConfigType("yaml")
		viper.AddConfigPath("$HOME/.vaultctl")
		viper.AddConfigPath(".")
	}

	viper.SetEnvPrefix("VAULTCTL")
	viper.AutomaticEnv()

	viper.SetDefault("vault.addr", "http://localhost:8200")
	viper.SetDefault("vault.timeout", "30s")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return fmt.Errorf("config: %w", err)
		}
	}

	return nil
}

// secrets subcommand group
func newSecretsCmd(opts *GlobalOpts) *cobra.Command {
	secrets := &cobra.Command{
		Use:   "secrets",
		Short: "Manage secrets",
	}

	secrets.AddCommand(
		newSecretsListCmd(opts),
		newSecretsGetCmd(opts),
		newSecretsSetCmd(opts),
		newSecretsDeleteCmd(opts),
	)

	return secrets
}

func newSecretsListCmd(opts *GlobalOpts) *cobra.Command {
	var path string

	return &cobra.Command{
		Use:     "list",
		Short:   "List secrets at a path",
		Aliases: []string{"ls"},

		RunE: func(cmd *cobra.Command, args []string) error {
			if path == "" {
				path = viper.GetString("default.path")
			}
			if path == "" {
				path = "secret/"
			}

			// In real code: call vault API
			secrets := []string{"db/postgres", "api/stripe", "tls/cert"}

			switch opts.Output {
			case "json":
				fmt.Fprintf(cmd.OutOrStdout(), `["db/postgres","api/stripe","tls/cert"]`+"\n")
			default:
				for _, s := range secrets {
					fmt.Fprintln(cmd.OutOrStdout(), s)
				}
			}

			return nil
		},
	}
}

func newSecretsGetCmd(opts *GlobalOpts) *cobra.Command {
	return &cobra.Command{
		Use:   "get PATH",
		Short: "Get a secret value",
		Args:  cobra.ExactArgs(1),

		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]

			// Simulate API call
			spinner := NewSpinner(fmt.Sprintf("Fetching %s...", path))
			for i := 0; i < 5; i++ {
				spinner.Tick()
			}
			spinner.Done(true)

			if opts.Output == "json" {
				fmt.Fprintf(cmd.OutOrStdout(), `{"path":%q,"value":"s3cr3t"}`+"\n", path)
			} else {
				fmt.Fprintf(cmd.OutOrStdout(), "%-20s %s\n", path, "s3cr3t")
			}

			return nil
		},
	}
}

func newSecretsSetCmd(opts *GlobalOpts) *cobra.Command {
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "set PATH VALUE",
		Short: "Set a secret value",
		Args:  cobra.ExactArgs(2),

		RunE: func(cmd *cobra.Command, args []string) error {
			path, value := args[0], args[1]

			if dryRun {
				fmt.Fprintf(cmd.OutOrStdout(), "[dry-run] would set %s = %s\n", path, value)
				return nil
			}

			// Simulate API call
			PrintSuccess("Set %s", path)
			return nil
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "preview without storing")
	return cmd
}

func newSecretsDeleteCmd(opts *GlobalOpts) *cobra.Command {
	var force bool

	return &cobra.Command{
		Use:     "delete PATH",
		Short:   "Delete a secret",
		Aliases: []string{"del", "rm"},
		Args:    cobra.ExactArgs(1),

		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]

			if !force {
				p := NewPrompter()
				if !p.Confirm(fmt.Sprintf("Delete secret %q?", path), false) {
					fmt.Fprintln(cmd.OutOrStdout(), "Cancelled.")
					return nil
				}
			}

			PrintSuccess("Deleted %s", path)
			return nil
		},
	}
}

func newAuditCmd(opts *GlobalOpts) *cobra.Command {
	return &cobra.Command{
		Use:   "audit",
		Short: "Show audit log",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprintln(cmd.OutOrStdout(), "2026-06-10 14:00:00  admin  GET  secret/db/postgres")
			fmt.Fprintln(cmd.OutOrStdout(), "2026-06-10 14:01:00  ci-bot SET  secret/api/stripe")
			return nil
		},
	}
}

func newConfigCmd(opts *GlobalOpts) *cobra.Command {
	config := &cobra.Command{
		Use:   "config",
		Short: "Manage vaultctl configuration",
	}

	config.AddCommand(&cobra.Command{
		Use:   "show",
		Short: "Show current configuration",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Fprintf(cmd.OutOrStdout(), "Vault address: %s\n", viper.GetString("vault.addr"))
			fmt.Fprintf(cmd.OutOrStdout(), "Config file:   %s\n", viper.ConfigFileUsed())
		},
	})

	config.AddCommand(&cobra.Command{
		Use:   "init",
		Short: "Create default config file",
		RunE: func(cmd *cobra.Command, args []string) error {
			defaultConfig := `# vaultctl configuration
vault:
  addr: http://localhost:8200
  timeout: 30s

default:
  path: secret/
`
			if err := os.WriteFile(".vaultctl.yaml", []byte(defaultConfig), 0600); err != nil {
				return fmt.Errorf("write config: %w", err)
			}
			PrintSuccess("Created .vaultctl.yaml")
			return nil
		},
	})

	return config
}

// Helper functions (from previous sections, included here for compilation)
// In a real project: package internal/ui

type Spinner struct {
	frames  []string
	current int
	message string
}

func NewSpinner(message string) *Spinner {
	return &Spinner{
		frames:  []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"},
		message: message,
	}
}

func (s *Spinner) Tick() {
	if !isTerminal(os.Stdout) {
		return
	}
	frame := s.frames[s.current%len(s.frames)]
	fmt.Printf("\r%s %s", frame, s.message)
	s.current++
}

func (s *Spinner) Done(success bool) {
	if success {
		fmt.Printf("\r✓ %s\n", s.message)
	} else {
		fmt.Fprintf(os.Stderr, "\r✗ %s\n", s.message)
	}
}

func PrintSuccess(format string, args ...interface{}) {
	fmt.Printf("✓ %s\n", fmt.Sprintf(format, args...))
}

func PrintError(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "✗ %s\n", fmt.Sprintf(format, args...))
}

type Prompter struct {
	in  *bufio.Reader
	out *os.File
}

func NewPrompter() *Prompter {
	return &Prompter{in: bufio.NewReader(os.Stdin), out: os.Stdout}
}

func (p *Prompter) Confirm(question string, defaultYes bool) bool {
	prompt := "[y/N]"
	if defaultYes {
		prompt = "[Y/n]"
	}
	fmt.Fprintf(p.out, "%s %s: ", question, prompt)
	input, _ := p.in.ReadString('\n')
	input = strings.ToLower(strings.TrimSpace(input))
	switch input {
	case "y", "yes":
		return true
	case "n", "no":
		return false
	case "":
		return defaultYes
	default:
		return p.Confirm(question, defaultYes)
	}
}

func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}

import "bufio" // needed for Prompter
import "strings" // needed for Prompter
```

> **Note**: The complete `vaultctl` example above shows the full structure. To actually compile it, split it into separate files per package convention and run `go mod init vaultctl && go get github.com/spf13/cobra github.com/spf13/viper`.

---

## Part 7: Testing CLI Commands

### Why testable CLIs matter

A CLI that can only be tested by running the actual binary is slow and fragile. Cobra's `OutOrStdout()` / `ErrOrStderr()` / `InOrStdin()` methods exist specifically for testing: you inject a `*bytes.Buffer` and inspect what was written.

```go
package cmd_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// executeCommand runs a cobra command with the given args,
// returns stdout and stderr output.
func executeCommand(root *cobra.Command, args ...string) (string, string, error) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	root.SetOut(stdout)
	root.SetErr(stderr)
	root.SetArgs(args)

	err := root.Execute()

	return stdout.String(), stderr.String(), err
}

func TestVersionCommand(t *testing.T) {
	root := &cobra.Command{Use: "test"}
	root.AddCommand(&cobra.Command{
		Use: "version",
		Run: func(cmd *cobra.Command, args []string) {
			cmd.Println("test v1.0.0")
		},
	})

	stdout, _, err := executeCommand(root, "version")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(stdout, "v1.0.0") {
		t.Errorf("expected version in output, got: %q", stdout)
	}
}

func TestGetCommandJSON(t *testing.T) {
	root := &cobra.Command{Use: "test", SilenceUsage: true}
	// ... add your real command here

	stdout, _, err := executeCommand(root, "get", "pods", "--output", "json")
	if err != nil {
		t.Fatalf("get command failed: %v", err)
	}

	// Verify JSON output structure
	if !strings.HasPrefix(stdout, "[") {
		t.Errorf("expected JSON array output, got: %q", stdout)
	}
}

func TestDeleteRequiresConfirmation(t *testing.T) {
	// Non-interactive input injection
	root := &cobra.Command{Use: "test", SilenceUsage: true}
	deleteCmd := &cobra.Command{
		Use:  "delete NAME",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var confirm string
			fmt.Fscan(cmd.InOrStdin(), &confirm)
			if confirm != "y" {
				cmd.Println("Cancelled.")
				return nil
			}
			cmd.Printf("Deleted %s\n", args[0])
			return nil
		},
	}
	root.AddCommand(deleteCmd)

	// Simulate user typing "y"
	root.SetIn(strings.NewReader("y\n"))
	stdout, _, err := executeCommand(root, "delete", "my-resource")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "Deleted") {
		t.Errorf("expected deleted message, got: %q", stdout)
	}

	// Simulate user typing "n"
	root2 := root // create fresh instance for isolation
	root2.SetIn(strings.NewReader("n\n"))
	stdout2, _, _ := executeCommand(root2, "delete", "my-resource")
	if !strings.Contains(stdout2, "Cancelled") {
		t.Errorf("expected cancelled message, got: %q", stdout2)
	}
}
```

---

## Summary: CLI Tool Checklist

```
Standard library (flag):
  [ ] Use for single-command tools with few flags
  [ ] Define flag.Usage for custom help text
  [ ] Use flag.Args() for positional arguments after --

Cobra:
  [ ] Use for multi-subcommand CLIs
  [ ] Set SilenceUsage: true on root command
  [ ] Set SilenceErrors: true — handle errors in main()
  [ ] Use cmd.OutOrStdout() / cmd.ErrOrStderr() (not fmt.Println)
  [ ] Validate args with cobra.ExactArgs / MinimumNArgs
  [ ] Add Aliases for common abbreviations (del, rm, ls)
  [ ] Use PersistentPreRunE for shared initialization (config, logging)

Viper:
  [ ] Set defaults for every config key
  [ ] Use SetEnvPrefix to namespace env vars
  [ ] Call AutomaticEnv() for env var binding
  [ ] Unmarshal into a typed struct — not viper.GetString() everywhere
  [ ] Validate the loaded config before use

Output:
  [ ] Errors → os.Stderr (cmd.ErrOrStderr())
  [ ] Data → os.Stdout (cmd.OutOrStdout())
  [ ] Check IsTerminal before emitting ANSI codes
  [ ] Support --output json|table for scripting
  [ ] Progress bars/spinners for operations > 1 second

Testing:
  [ ] Use executeCommand(root, args...) helper with injected buffers
  [ ] Test each subcommand in isolation
  [ ] Test both success and error paths
  [ ] Test --output json separately from --output table
  [ ] Inject stdin for interactive prompt tests

Distribution:
  [ ] Use -ldflags "-X main.version=$(git describe)" for version injection
  [ ] Cross-compile: GOOS=linux GOARCH=amd64 go build
  [ ] Embed completions: cobra.GenBashCompletion, GenZshCompletion
  [ ] Add --completion flag for shell autocomplete setup
```
