# Google Classroom Search

[![Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-install-670000)](https://greasyfork.org/en/scripts/604099-google-classroom-search)

A [Tampermonkey](https://www.tampermonkey.net/) userscript that adds live search and custom tags to the Google Classroom class list.

## Features

- **Live search box** in Classroom's own header bar, filters your class cards as you type, by name, section, teacher, or tag. Press `/` anywhere on the page to jump to it.
- **Custom tags** - click the tag row on any class card to assign your own tags (`favorite`, `hard`, `morning`, whatever). Tags are searchable alongside everything else.
- **Export / import tags** - back up your tags to a JSON file or move them to another browser/computer, via the ⇅ button next to the search box.

Tags are stored in `localStorage`, scoped to `classroom.google.com` — they never leave your browser except when you explicitly export them.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Install the script from [Greasy Fork](https://greasyfork.org/en/scripts/604099-google-classroom-search) (recommended), or directly from [classroom-search.user.js](https://raw.githubusercontent.com/tomandesMSH/ClassroomSearch/main/classroom-search.user.js) — either way, Tampermonkey will prompt to install it automatically.

The script auto-updates after install, so you don't need to reinstall it after future changes.
