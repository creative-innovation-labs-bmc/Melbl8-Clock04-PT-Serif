# Project brief

## Description

A 3840 × 804 Melbourne natural-language typewriter clock using PT Serif and Open Sans, optimised for Enplug and NVIDIA Shield signage.

## Build brief

Purpose:
Create an independent fork-style version of `creative-innovation-labs-bmc/Melbl8-Clock04-Typewriter` without changing the existing Bitter production clock.

Typography:
- Use PT Serif Bold for the animated natural-language clock sentence.
- Use Open Sans Regular for Melbourne, date, Live status and all supporting interface text.
- Use official Google Fonts assets and include their OFL licence files.
- Self-host the production font files so Enplug does not depend on Google Fonts CDN availability.

Behaviour to preserve:
- Fixed 3840 × 804 stage.
- Single-line production layout.
- Live Melbourne time with varied lead-in phrases.
- Spoken time words highlighted in Aurecon Green #89C925.
- Smooth typewriter deletion, insertion and sentence resizing.
- Automatic viewport scaling for mobile testing.
- NVIDIA Shield and Enplug compatibility using vanilla HTML, CSS and JavaScript.
- No demo mode on the production URL.

Deployment and privacy:
- GitHub Pages enabled.
- robots.txt must disallow all crawlers.
- Include noindex, nofollow, noarchive, nosnippet and noimageindex metadata.
- Provide an explicit cache-busted Enplug production URL if needed.

Reference fonts:
- https://fonts.google.com/specimen/PT+Serif
- https://fonts.google.com/specimen/Open+Sans

Source reference:
- https://github.com/creative-innovation-labs-bmc/Melbl8-Clock04-Typewriter
