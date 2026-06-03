# <img src="./src-tauri/icons/128x128.png" width="64"/> Splicerr

> [!IMPORTANT]
> **I am _not_ the developer or maintainer of Splicerr.** This is a temporary
> community fork of [Robert-K/splicerr](https://github.com/Robert-K/splicerr),
> published only to help users while the upstream app is broken.
>
> Splice's GraphQL API started requiring Apollo preflight headers, which stopped
> upstream from loading samples. This fork applies that fix (see upstream
> [issue #30](https://github.com/Robert-K/splicerr/issues/30)) so the app works again.
> **Once the fix is merged upstream, please go back to the [original repository](https://github.com/Robert-K/splicerr).**
>
> All credit goes to the original authors — [@Robert-K](https://github.com/Robert-K)
> and [@ascpixi](https://github.com/ascpixi). As a small bonus, this fork also adds a
> tempo-preserving **Transpose** feature (see [Features](#features)).

**Splicerr** is an alternative frontend for the popular [Splice](https://splice.com/features/sounds) sample library. It does not require any authentication and contains all of the most important features of the regular desktop app (including drag-and-drop).

It's basically a full rewrite of [ascpixi's](https://github.com/ascpixi) [Splicedd ❤️](https://github.com/ascpixi/splicedd), just with a couple more features and built with [Svelte](https://svelte.dev/) and [Tauri 2.0](https://v2.tauri.app/).

Please show your appreciation by starring ⭐ the [original project](https://github.com/ascpixi/splicedd), as it made this all possible.

<p align="center">
  <br>
  <a href="https://github.com/robert-k/splicerr/releases/"><b>Click here to download the latest release!</b></a>
</p>

## Demo

https://github.com/user-attachments/assets/34f1ba90-c881-4a04-a5df-c147bdb51c2c

## Features

- Drag-and-drop samples
- **Transpose by key or pitch (tempo-preserving)** ✨ _new in this fork_
- Search suggestions
- Tag filtering
- Infinite scrolling
- Waveform previews
- Sort by popularity, bpm & more
- Dark & light mode
- Custom UI scale
- Adjustable preview volume

## 🔧 How to develop

1. Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) & [pnpm](https://pnpm.io/installation)
2. Clone the project: `git clone https://github.com/robert-k/splicerr`
3. Install dependencies: `pnpm i`
4. Start the development server: `pnpm tauri dev`

## 💡 Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

[![forthebadge](https://forthebadge.com/images/badges/contains-17-coffee-cups.svg)](https://forthebadge.com) [![forthebadge](https://forthebadge.com/images/badges/made-with-out-pants.svg)](https://forthebadge.com) [![forthebadge](https://forthebadge.com/images/badges/works-on-my-machine.svg)](https://forthebadge.com)
