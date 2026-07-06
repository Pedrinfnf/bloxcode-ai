// ═══════════════════════════════════════════════════════════════════════════════
// BLOXCODE TUI — Ratatui-based terminal UI
// Full interactive terminal with panels, model selector, chat view
// ═══════════════════════════════════════════════════════════════════════════════

use std::io;
use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    execute,
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Frame, Terminal,
};
use bloxcode_core::Config;

struct App {
    input: String,
    messages: Vec<ChatMsg>,
    status: String,
    model: String,
    mode: String,
    should_quit: bool,
    scroll: u16,
}

struct ChatMsg {
    role: String,
    content: String,
}

impl App {
    fn new(config: &Config) -> Self {
        Self {
            input: String::new(),
            messages: vec![ChatMsg {
                role: "system".into(),
                content: "Welcome to BloxCode TUI. Type a message or /help.".into(),
            }],
            status: "ready".into(),
            model: config.model.clone(),
            mode: format!("{:?}", config.mode).to_lowercase(),
            should_quit: false,
            scroll: 0,
        }
    }
}

fn ui(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),     // Header
            Constraint::Min(1),        // Chat
            Constraint::Length(3),     // Input
            Constraint::Length(1),     // Status bar
        ])
        .split(f.area());

    // ── Header ──
    let header = Paragraph::new(Line::from(vec![
        Span::styled("● ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::styled("bloxcode", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::styled(" · ", Style::default().fg(Color::DarkGray)),
        Span::styled(&app.model, Style::default().fg(Color::Yellow)),
        Span::styled(" · ", Style::default().fg(Color::DarkGray)),
        Span::styled(&app.mode, Style::default().fg(Color::Green)),
    ]))
    .block(Block::default().borders(Borders::BOTTOM).border_style(Style::default().fg(Color::DarkGray)));
    f.render_widget(header, chunks[0]);

    // ── Chat messages ──
    let msgs: Vec<ListItem> = app.messages.iter().map(|m| {
        let style = match m.role.as_str() {
            "user" => Style::default().fg(Color::White),
            "assistant" => Style::default().fg(Color::Cyan),
            "system" => Style::default().fg(Color::DarkGray),
            _ => Style::default(),
        };
        let prefix = match m.role.as_str() {
            "user" => "you > ",
            "assistant" => "ai  > ",
            "system" => "sys > ",
            _ => "??? > ",
        };
        ListItem::new(Line::from(vec![
            Span::styled(prefix, style.add_modifier(Modifier::BOLD)),
            Span::styled(&m.content, style),
        ]))
    }).collect();

    let chat = List::new(msgs)
        .block(Block::default()
            .borders(Borders::NONE)
            .title(" chat ")
            .title_style(Style::default().fg(Color::DarkGray)));
    f.render_widget(chat, chunks[1]);

    // ── Input ──
    let input = Paragraph::new(Line::from(vec![
        Span::styled("> ", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
        Span::raw(&app.input),
        Span::styled("█", Style::default().fg(Color::Cyan)),
    ]))
    .block(Block::default()
        .borders(Borders::TOP)
        .border_style(Style::default().fg(Color::DarkGray)));
    f.render_widget(input, chunks[2]);

    // ── Status bar ──
    let status = Paragraph::new(Line::from(vec![
        Span::styled(" /help", Style::default().fg(Color::DarkGray)),
        Span::styled(" · ", Style::default().fg(Color::DarkGray)),
        Span::styled("/model", Style::default().fg(Color::DarkGray)),
        Span::styled(" · ", Style::default().fg(Color::DarkGray)),
        Span::styled("/exit", Style::default().fg(Color::DarkGray)),
        Span::styled("                    ", Style::default()),
        Span::styled(&app.status, Style::default().fg(Color::DarkGray)),
    ]));
    f.render_widget(status, chunks[3]);
}

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::load().unwrap_or_default();

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new(&config);

    // Main loop
    loop {
        terminal.draw(|f| ui(f, &app))?;

        if let Event::Key(key) = event::read()? {
            match key.code {
                KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    app.should_quit = true;
                }
                KeyCode::Char(c) => {
                    app.input.push(c);
                }
                KeyCode::Backspace => {
                    app.input.pop();
                }
                KeyCode::Enter => {
                    let input = app.input.clone();
                    app.input.clear();

                    if input.is_empty() { continue; }

                    if input == "/exit" || input == "/quit" {
                        app.should_quit = true;
                        continue;
                    }

                    app.messages.push(ChatMsg {
                        role: "user".into(),
                        content: input.clone(),
                    });

                    // TODO: send to LLM via bloxcode-core streaming
                    app.messages.push(ChatMsg {
                        role: "assistant".into(),
                        content: format!("[TUI mode — LLM integration coming soon. You said: {}]", input),
                    });
                    app.status = format!("{} messages", app.messages.len());
                }
                KeyCode::Esc => {
                    app.should_quit = true;
                }
                _ => {}
            }
        }

        if app.should_quit { break; }
    }

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    println!("\n  ● goodbye\n");
    Ok(())
}
