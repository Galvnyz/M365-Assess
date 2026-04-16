<#
.SYNOPSIS
    Assembles the full HTML document for the assessment report.
.DESCRIPTION
    Contains the complete HTML template including CSS theme (light + dark mode),
    cover page, executive summary, content assembly, and JavaScript for filtering,
    sorting, and theme toggle. Runs in the caller's scope via dot-sourcing -- all
    variables from Export-AssessmentReport.ps1 and Build-SectionHtml.ps1 are
    available directly.

    Produces: $html (the complete HTML document string).
.NOTES
    Author: Daren9m
    Extracted from Export-AssessmentReport.ps1 for maintainability (#235).
#>

# ------------------------------------------------------------------
# Assemble full HTML document
# ------------------------------------------------------------------
$coverBgStyle = if ($waveBase64) {
    "background-image: url('data:$waveMime;base64,$waveBase64'); background-size: cover; background-position: center;"
} else {
    'background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);'
}

$logoImgTag = if ($logoBase64) {
    "<img src='data:$logoMime;base64,$logoBase64' alt='$brandName' class='cover-logo' />"
} else {
    "<div class='cover-logo-text'>$brandName</div>"
}

$accentCss = if ($accentColor) { "<style>:root { --m365a-accent: $accentColor; }</style>" } else { '' }

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M365 Assessment Report - $(ConvertTo-HtmlSafe -Text $TenantName)</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        .skip-nav { position: absolute; left: -9999px; top: auto; }
        .skip-nav:focus { left: 10px; top: 10px; z-index: 9999; background: var(--m365a-card-bg); padding: 8px 16px; border: 2px solid var(--m365a-primary); border-radius: 4px; color: var(--m365a-text); text-decoration: none; }
    </style>
    <style>
        /* ----------------------------------------------------------
           M365 Assess Theme
           ---------------------------------------------------------- */
        :root {
            --m365a-primary: #2563EB;
            --m365a-dark-primary: #1D4ED8;
            --m365a-accent: #60A5FA;
            --m365a-dark: #0F172A;
            --m365a-dark-gray: #1E293B;
            --m365a-medium-gray: #64748B;
            --m365a-light-gray: #F1F5F9;
            --m365a-border: #CBD5E1;
            --m365a-white: #ffffff;
            --m365a-success: #2ecc71;
            --m365a-warning: #f39c12;
            --m365a-danger: #e74c3c;
            --m365a-info: #3498db;
            --m365a-success-bg: #d4edda;
            --m365a-warning-bg: #fff3cd;
            --m365a-danger-bg: #f8d7da;
            --m365a-info-bg: #d1ecf1;
            --m365a-review: #8B5CF6;
            --m365a-neutral: #6b7280;
            --m365a-neutral-bg: #f3f4f6;
            --m365a-body-bg: #ffffff;
            --m365a-text: #1E293B;
            --m365a-card-bg: #ffffff;
            --m365a-hover-bg: #e8f4f8;

            /* Badge text colors */
            --m365a-success-text: #155724;
            --m365a-danger-text: #721c24;
            --m365a-warning-text: #856404;
            --m365a-info-text: #0c5460;
            --m365a-skipped-bg: #e2e3e5;
            --m365a-skipped-text: #383d41;
            --m365a-critical-bg: #991b1b;
            --m365a-critical-text: #fef2f2;

            /* Cloud badges */
            --m365a-cloud-comm-bg: #e8f0fe;
            --m365a-cloud-comm-text: #1a73e8;
            --m365a-cloud-comm-border: #c5d9f7;
            --m365a-cloud-gcc-bg: #e6f4ea;
            --m365a-cloud-gcc-text: #137333;
            --m365a-cloud-gcc-border: #b7e1c5;
            --m365a-cloud-gcch-bg: #fef3e0;
            --m365a-cloud-gcch-text: #c26401;
            --m365a-cloud-gcch-border: #f5d9a8;
            --m365a-cloud-dod-bg: #fce8e6;
            --m365a-cloud-dod-text: #c5221f;
            --m365a-cloud-dod-border: #f5b7b1;

            /* DKIM badges */
            --m365a-dkim-warn-bg: #fff3cd;
            --m365a-dkim-warn-text: #856404;
            --m365a-dkim-ok-bg: #d4edda;
            --m365a-dkim-ok-text: #155724;
        }

        body.dark-theme {
            --m365a-primary: #60A5FA;
            --m365a-dark-primary: #93C5FD;
            --m365a-accent: #3B82F6;
            --m365a-dark: #F1F5F9;
            --m365a-dark-gray: #E2E8F0;
            --m365a-medium-gray: #94A3B8;
            --m365a-light-gray: #1E293B;
            --m365a-border: #334155;
            --m365a-white: #0F172A;
            --m365a-body-bg: #0F172A;
            --m365a-text: #E2E8F0;
            --m365a-card-bg: #1E293B;
            --m365a-hover-bg: #1E3A5F;
            --m365a-success: #34D399;
            --m365a-warning: #FBBF24;
            --m365a-danger: #F87171;
            --m365a-info: #60A5FA;
            --m365a-success-bg: #064E3B;
            --m365a-warning-bg: #78350F;
            --m365a-danger-bg: #7F1D1D;
            --m365a-info-bg: #1E3A5F;
            --m365a-review: #A78BFA;
            --m365a-neutral: #9ca3af;
            --m365a-neutral-bg: #374151;

            /* Badge text colors */
            --m365a-success-text: #6EE7B7;
            --m365a-danger-text: #FCA5A5;
            --m365a-warning-text: #FCD34D;
            --m365a-info-text: #93C5FD;
            --m365a-skipped-bg: #334155;
            --m365a-skipped-text: #94A3B8;
            --m365a-critical-bg: #7F1D1D;
            --m365a-critical-text: #FCA5A5;

            /* Cloud badges */
            --m365a-cloud-comm-bg: #1E3A5F;
            --m365a-cloud-comm-text: #93C5FD;
            --m365a-cloud-comm-border: #334155;
            --m365a-cloud-gcc-bg: #064E3B;
            --m365a-cloud-gcc-text: #6EE7B7;
            --m365a-cloud-gcc-border: #334155;
            --m365a-cloud-gcch-bg: #78350F;
            --m365a-cloud-gcch-text: #FCD34D;
            --m365a-cloud-gcch-border: #334155;
            --m365a-cloud-dod-bg: #7F1D1D;
            --m365a-cloud-dod-text: #FCA5A5;
            --m365a-cloud-dod-border: #334155;

            /* DKIM badges */
            --m365a-dkim-warn-bg: #78350F;
            --m365a-dkim-warn-text: #FCD34D;
            --m365a-dkim-ok-bg: #064E3B;
            --m365a-dkim-ok-text: #6EE7B7;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        /* Screen-reader-only utility (visually hidden but accessible) */
        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }

        body {
            font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            font-size: 13pt;
            line-height: 1.65;
            color: var(--m365a-text);
            background: var(--m365a-body-bg);
        }

        a { color: var(--m365a-primary); }
        a:hover { color: var(--m365a-accent); }

        /* ----------------------------------------------------------
           Cover Page
           ---------------------------------------------------------- */
        .cover-page {
            position: relative;
            width: 100%;
            min-height: 100vh;
            $coverBgStyle
            background-color: var(--m365a-dark);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            color: var(--m365a-white);
            page-break-after: always;
            padding: 60px 40px;
        }

        .cover-logo {
            max-width: 500px;
            height: auto;
            margin-bottom: 40px;
        }

        .cover-logo-text {
            font-size: 28pt;
            font-weight: bold;
            letter-spacing: 2px;
            margin-bottom: 50px;
        }

        .cover-title {
            font-size: 32pt;
            font-weight: 300;
            letter-spacing: 3px;
            text-transform: uppercase;
            margin-bottom: 15px;
        }

        .cover-subtitle {
            font-size: 16pt;
            font-weight: 300;
            opacity: 0.9;
            margin-bottom: 8px;
        }

        .cover-tenant {
            font-size: 20pt;
            font-weight: 600;
            color: var(--m365a-primary);
            margin-top: 30px;
            margin-bottom: 15px;
        }

        .cover-date {
            font-size: 13pt;
            opacity: 0.7;
            margin-top: 10px;
        }

        .cover-divider {
            width: 80px;
            height: 3px;
            background: var(--m365a-primary);
            margin: 25px auto;
        }

        .cover-branding {
            position: absolute;
            bottom: 32px;
            left: 0;
            right: 0;
            text-align: center;
        }
        .cover-branding-link {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 16px;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 20px;
            color: rgba(255,255,255,0.6);
            text-decoration: none;
            font-size: 0.8em;
            letter-spacing: 0.3px;
            transition: all 0.2s ease;
            background: rgba(255,255,255,0.05);
        }
        .cover-branding-link:hover {
            color: rgba(255,255,255,0.9);
            border-color: rgba(255,255,255,0.4);
            background: rgba(255,255,255,0.1);
        }
        .cover-branding-icon { flex-shrink: 0; opacity: 0.7; }

        /* Full cover page hidden on screen, shown in print */
        .cover-print-only { display: none; }

        /* Quick Scan mode banner */
        .quickscan-banner {
            background: #f59e0b;
            color: #1a1a1a;
            text-align: center;
            padding: 8px 16px;
            font-weight: 600;
            font-size: 9.5pt;
            border-radius: 6px;
            margin-bottom: 12px;
        }
        body.dark-theme .quickscan-banner {
            background: #b45309;
            color: #fff;
        }

        /* Compact hero banner (screen only) */
        .hero-banner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 32px;
            background: #0f172a;
            color: var(--m365a-white);
            margin: -40px -80px 24px -80px;
            width: calc(100% + 160px);
        }
        .hero-banner-left {
            display: flex;
            align-items: center;
            gap: 20px;
        }
        .hero-banner-logo {
            height: 64px;
            width: auto;
        }
        .hero-banner-title {
            font-size: 16pt;
            font-weight: 700;
            letter-spacing: 0.5px;
            color: #ffffff;
        }
        .hero-banner-meta {
            font-size: 10pt;
            color: rgba(255,255,255,0.65);
            margin-top: 4px;
        }
        body.dark-theme .hero-banner {
            background: #020617;
            border-bottom: 1px solid var(--m365a-border);
        }

        /* ----------------------------------------------------------
           Content Pages
           ---------------------------------------------------------- */
        .content {
            max-width: none;
            margin: 0 auto;
            padding: 40px 80px;
        }

        h1 {
            font-size: 22pt;
            color: var(--m365a-dark);
            border-bottom: 3px solid var(--m365a-primary);
            padding-bottom: 10px;
            margin: 40px 0 25px 0;
            page-break-after: avoid;
        }

        h2 {
            font-size: 16pt;
            color: var(--m365a-dark);
            border-left: 4px solid var(--m365a-primary);
            padding-left: 15px;
            margin: 35px 0 20px 0;
            page-break-after: avoid;
        }

        h3 {
            font-size: 12pt;
            color: var(--m365a-medium-gray);
            margin: 25px 0 12px 0;
            page-break-after: avoid;
        }

        .section-description {
            color: var(--m365a-medium-gray);
            font-size: 10pt;
            line-height: 1.6;
            margin: 0 0 15px 0;
            padding-left: 19px;
        }

        /* ----------------------------------------------------------
           Inline Explanation Callouts
           ---------------------------------------------------------- */
        /* Section toolbar — expand/collapse inline with heading */
        .section-toolbar {
            display: flex;
            gap: 8px;
            margin: -8px 0 12px 0;
        }
        .section-ctrl-btn {
            font-size: 8pt;
            padding: 3px 10px;
            border-radius: 4px;
            border: 1px solid var(--m365a-border);
            background: var(--m365a-card-bg);
            color: var(--m365a-medium-gray);
            cursor: pointer;
        }
        .section-ctrl-btn:hover { color: var(--m365a-accent); border-color: var(--m365a-accent); }
        .section-description a { color: var(--m365a-accent); }
        .callout-wrapper { margin: 0 0 12px 0; }
        .callout-toggle {
            cursor: pointer;
            font-size: 9pt;
            font-weight: 600;
            color: var(--m365a-accent);
            list-style: none;
            padding: 4px 0;
        }
        .callout-toggle::-webkit-details-marker { display: none; }
        .callout-toggle::before { content: '\25B6\00A0'; font-size: 8pt; display: inline-block; transition: transform 0.2s; }
        details.callout-wrapper[open] > .callout-toggle::before { transform: rotate(90deg); }
        .callout-row { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0 0 0; }
        .callout {
            flex: 1 1 280px;
            max-width: 480px;
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
            border-left: 4px solid var(--m365a-accent);
            background: var(--m365a-card-bg);
        }
        .callout-info { border-left-color: var(--m365a-info); }
        .callout-warning { border-left-color: var(--m365a-warning); }
        .callout-tip { border-left-color: var(--m365a-success); }
        .callout-title {
            padding: 10px 14px;
            font-weight: 600;
            font-size: 9.5pt;
            color: var(--m365a-dark);
        }
        .callout-icon { margin-right: 6px; }
        .callout-body {
            padding: 0 14px 12px;
            font-size: 9pt;
            color: var(--m365a-medium-gray);
            line-height: 1.6;
        }

        /* Accordion callout (Email protocols) */
        .callout-accordion {
            flex: 1 1 100%;
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
            background: var(--m365a-card-bg);
            overflow: hidden;
        }
        .callout-accordion-title {
            padding: 10px 14px;
            font-weight: 600;
            font-size: 9.5pt;
            color: var(--m365a-accent);
            cursor: pointer;
            list-style: none;
        }
        .callout-accordion-title::-webkit-details-marker { display: none; }
        .callout-accordion-title::before {
            content: '\25B6  ';
            font-size: 8pt;
            transition: transform 0.2s;
            display: inline-block;
            margin-right: 6px;
        }
        details.callout-accordion[open] > .callout-accordion-title::before { transform: rotate(90deg); }
        .accordion-item {
            border-bottom: 1px solid var(--m365a-border);
        }
        .accordion-item:last-of-type { border-bottom: none; }
        .accordion-item summary {
            padding: 8px 14px;
            font-weight: 600;
            font-size: 9pt;
            color: var(--m365a-accent);
            cursor: pointer;
            list-style: none;
        }
        .accordion-item summary::-webkit-details-marker { display: none; }
        .accordion-item summary::before {
            content: '\25B6  ';
            font-size: 7pt;
            transition: transform 0.2s;
            display: inline-block;
            margin-right: 6px;
        }
        .accordion-item[open] > summary::before { transform: rotate(90deg); }
        .accordion-item-body {
            padding: 0 14px 10px 28px;
            font-size: 9pt;
            color: var(--m365a-medium-gray);
            line-height: 1.6;
        }
        .accordion-item-body code {
            background: var(--m365a-border);
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 8.5pt;
        }
        .accordion-item-body a { color: var(--m365a-accent); text-decoration: none; }
        .accordion-item-body a:hover { text-decoration: underline; }
        .accordion-resources {
            padding: 8px 14px;
            font-size: 8.5pt;
            color: var(--m365a-medium-gray);
            border-top: 1px solid var(--m365a-border);
        }
        .accordion-resources a { color: var(--m365a-accent); text-decoration: none; }
        .accordion-resources a:hover { text-decoration: underline; }

        /* Tabbed callout (protocol explainers) */
        .callout-tabs {
            flex: 1 1 100%;
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
            background: var(--m365a-card-bg);
            overflow: hidden;
        }
        .callout-tabs-title {
            padding: 10px 14px 0;
            font-weight: 600;
            font-size: 9.5pt;
            color: var(--m365a-accent);
        }
        .tab-header {
            display: flex;
            gap: 0;
            border-bottom: 1px solid var(--m365a-border);
            padding: 0 14px;
        }
        .tab-btn {
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            padding: 8px 14px;
            font-size: 9pt;
            font-weight: 600;
            color: var(--m365a-medium-gray);
            cursor: pointer;
            transition: color 0.15s, border-color 0.15s;
        }
        .tab-btn:hover {
            color: var(--m365a-accent);
        }
        .tab-btn.active {
            color: var(--m365a-accent);
            border-bottom-color: var(--m365a-accent);
        }
        .tab-panel {
            display: none;
            padding: 10px 14px 10px 28px;
            font-size: 9pt;
            color: var(--m365a-medium-gray);
            line-height: 1.6;
        }
        .tab-panel.active {
            display: block;
        }
        .tab-panel code {
            background: var(--m365a-border);
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 8.5pt;
        }
        .tab-panel a { color: var(--m365a-accent); text-decoration: none; }
        .tab-panel a:hover { text-decoration: underline; }
        .tab-resources {
            padding: 8px 14px;
            font-size: 8.5pt;
            color: var(--m365a-medium-gray);
            border-top: 1px solid var(--m365a-border);
        }
        .tab-resources a { color: var(--m365a-accent); text-decoration: none; }
        .tab-resources a:hover { text-decoration: underline; }
        @media (max-width: 600px) {
            .tab-header { flex-direction: column; }
            .tab-btn { text-align: left; border-bottom: none; border-left: 2px solid transparent; }
            .tab-btn.active { border-left-color: var(--m365a-accent); border-bottom-color: transparent; }
        }

        /* ----------------------------------------------------------
           Executive Summary Hero
           ---------------------------------------------------------- */
        .exec-hero {
            display: grid;
            grid-template-columns: 1fr 1.5fr;
            grid-template-rows: auto auto;
            gap: 16px 24px;
            padding: 24px 28px;
            margin: 0 0 16px 0;
            background: var(--m365a-light-gray);
            border: 1px solid var(--m365a-border);
            border-radius: 10px;
        }
        .exec-hero-title {
            font-size: 17pt;
            font-weight: 700;
            color: var(--m365a-dark);
            margin: 0 0 6px 0;
            white-space: nowrap;
            border: none;
            padding: 0;
        }
        .exec-hero-desc {
            font-size: 9.5pt;
            color: var(--m365a-medium-gray);
            line-height: 1.5;
            margin: 0 0 16px 0;
        }
        .exec-hero-donut {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .exec-hero-stats {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .exec-hero-stat {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 9.5pt;
        }
        .exec-hero-metrics {
            grid-column: 1 / -1;
            display: flex;
            gap: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--m365a-border);
        }
        .exec-hero-metric {
            flex: 1;
            text-align: center;
            padding: 10px 12px;
            background: var(--m365a-card-bg);
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
        }
        .exec-hero-metric-value {
            font-size: 22pt;
            font-weight: 700;
            color: var(--m365a-accent);
            line-height: 1.1;
        }
        .exec-hero-metric-label {
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 4px;
        }
        .exec-hero-right {
            display: flex;
            flex-direction: column;
        }
        .exec-hero-toc-label {
            font-size: 9pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--m365a-medium-gray);
            margin-bottom: 10px;
            padding-bottom: 6px;
            border-bottom: 2px solid var(--m365a-border);
        }
        .exec-hero-toc {
            list-style: decimal;
            padding-left: 18px;
            margin: 0;
        }
        .exec-hero-toc li {
            padding: 3px 0;
            font-size: 9.5pt;
        }
        .exec-hero-toc a {
            color: var(--m365a-dark);
            text-decoration: none;
            transition: color 0.15s;
        }
        .exec-hero-toc a:hover {
            color: var(--m365a-accent);
        }
        .exec-alert {
            padding: 10px 16px;
            border-radius: 6px;
            font-size: 9.5pt;
            margin: 0 0 8px 0;
            line-height: 1.5;
        }
        .exec-alert a { color: var(--m365a-accent); text-decoration: none; }
        .exec-alert a:hover { text-decoration: underline; }
        .exec-alert-warn {
            background: var(--m365a-warning-bg);
            border-left: 3px solid var(--m365a-warning);
            color: var(--m365a-dark);
        }
        .exec-alert-info {
            background: var(--m365a-info-bg);
            border-left: 3px solid var(--m365a-accent);
            color: var(--m365a-dark);
        }

        /* ----------------------------------------------------------
           Service Area Breakdown Chart
           ---------------------------------------------------------- */
        .exec-hero-right {
            display: flex;
            align-items: center;
        }
        .service-area-chart-inline {
            width: 100%;
        }
        .service-area-chart-title {
            font-size: 10pt;
            font-weight: 600;
            color: var(--m365a-dark);
            margin-bottom: 8px;
        }
        .service-area-chart {
            margin: 20px 0;
            padding: 20px;
            background: var(--m365a-card-bg);
            border: 1px solid var(--m365a-border);
            border-radius: 8px;
        }
        .service-area-chart h3 {
            margin: 0 0 16px 0;
            font-size: 12pt;
            font-weight: 600;
            color: var(--m365a-dark);
            border: none;
            padding: 0;
        }
        .chart-nav-link { cursor: pointer; }
        .chart-nav-link:hover text:first-child { text-decoration: underline; fill: var(--m365a-accent); }

        /* ----------------------------------------------------------
           Tenant Organization Card
           ---------------------------------------------------------- */
        .tenant-card {
            background: var(--m365a-light-gray);
            border-left: 4px solid var(--m365a-primary);
            border-radius: 0 6px 6px 0;
            padding: 14px 20px;
            margin-bottom: 16px;
        }

        .tenant-heading {
            font-size: 11pt;
            color: var(--m365a-dark);
            margin: 0 0 8px 0;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--m365a-border);
            border-left: none;
            padding-left: 0;
        }

        .tenant-org-name {
            font-size: 15pt;
            font-weight: 700;
            color: var(--m365a-dark);
            margin-bottom: 8px;
        }

        .tenant-facts {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 0;
        }
        .tenant-fact {
            flex: 1 1 0;
            min-width: 140px;
        }

        .tenant-facts-secondary {
            margin-top: 8px;
        }

        .tenant-fact .fact-label {
            display: block;
            font-size: 7.5pt;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--m365a-medium-gray);
            margin-bottom: 1px;
        }

        .tenant-fact .fact-value {
            display: block;
            font-size: 10pt;
            font-weight: 600;
            color: var(--m365a-dark);
        }

        .tenant-id-val {
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 8.5pt !important;
            letter-spacing: 0.3px;
            white-space: nowrap;
        }

        .cloud-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 9pt;
            font-weight: 600;
            letter-spacing: 0.3px;
        }
        .cloud-commercial {
            background: var(--m365a-cloud-comm-bg);
            color: var(--m365a-cloud-comm-text);
            border: 1px solid var(--m365a-cloud-comm-border);
        }
        .cloud-gcc {
            background: var(--m365a-cloud-gcc-bg);
            color: var(--m365a-cloud-gcc-text);
            border: 1px solid var(--m365a-cloud-gcc-border);
        }
        .cloud-gcchigh {
            background: var(--m365a-cloud-gcch-bg);
            color: var(--m365a-cloud-gcch-text);
            border: 1px solid var(--m365a-cloud-gcch-border);
        }
        .cloud-dod {
            background: var(--m365a-cloud-dod-bg);
            color: var(--m365a-cloud-dod-text);
            border: 1px solid var(--m365a-cloud-dod-border);
        }

        .tenant-domains {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--m365a-border);
        }

        .tenant-domains .fact-label {
            display: block;
            font-size: 7.5pt;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--m365a-medium-gray);
            margin-bottom: 4px;
        }

        .domain-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .domain-tag {
            display: inline-block;
            padding: 2px 8px;
            background: var(--m365a-white);
            border: 1px solid var(--m365a-border);
            border-radius: 3px;
            font-size: 8.5pt;
            font-weight: 500;
            color: var(--m365a-dark);
        }

        .domain-tag.domain-system {
            color: var(--m365a-medium-gray);
            border-style: dashed;
            font-size: 8pt;
        }

        .tenant-meta {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--m365a-border);
            display: flex;
            flex-wrap: wrap;
            gap: 4px 16px;
            font-size: 8.5pt;
            color: var(--m365a-medium-gray);
        }

        /* ----------------------------------------------------------
           SVG Donut Charts
           ---------------------------------------------------------- */
        .donut-chart { display: block; margin: 0 auto; }
        .donut-track { stroke: var(--m365a-border); }
        .donut-fill { transition: stroke-dashoffset 0.6s ease, opacity 0.15s ease, stroke-width 0.15s ease; }
        .donut-success { stroke: var(--m365a-success); }
        .donut-warning { stroke: var(--m365a-warning); }
        .donut-danger { stroke: var(--m365a-danger); }
        .donut-review { stroke: var(--m365a-review); }
        .donut-info { stroke: var(--m365a-accent); }
        .donut-neutral { stroke: var(--m365a-neutral); }
        .donut-text { font-size: 22px; font-weight: 700; fill: var(--m365a-text); font-family: inherit; }
        .donut-text-sm { font-size: 16px; }
        /* Donut segment highlight on legend hover */
        .dash-panel.donut-hover-active .donut-fill { opacity: 0.3; }
        .dash-panel.donut-hover-active .donut-fill.donut-highlight { opacity: 1; stroke-width: 16; }
        .score-detail-row { transition: background 0.15s ease; border-radius: 4px; }
        .score-detail-row.donut-highlight { background: var(--m365a-hover-bg); }

        .chart-panel {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 24px;
            align-items: center;
            margin: 20px 0;
            padding: 20px;
            background: var(--m365a-light-gray);
            border-radius: 8px;
            border: 1px solid var(--m365a-border);
        }
        .chart-panel-center {
            grid-template-columns: 1fr;
            justify-items: center;
        }
        .chart-legend {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .chart-legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 10pt;
        }
        .chart-legend-dot {
            width: 12px; height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .chart-legend-dot.dot-success { background: var(--m365a-success); }
        .chart-legend-dot.dot-warning { background: var(--m365a-warning); }
        .chart-legend-dot.dot-danger { background: var(--m365a-danger); }
        .chart-legend-dot.dot-review { background: var(--m365a-review); }
        .chart-legend-dot.dot-info { background: var(--m365a-accent); }
        .chart-legend-dot.dot-neutral { background-color: var(--m365a-neutral); }
        .chart-legend-dot.dot-muted { background: var(--m365a-medium-gray); }

        /* Dash panel — donut + details side-by-side */
        .dash-panel {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 20px;
            align-items: center;
            padding: 24px;
            background: var(--m365a-light-gray);
            border-radius: 8px;
            border: 1px solid var(--m365a-border);
        }
        .dash-panel-donut { text-align: center; }
        .score-donut-label {
            margin-top: 8px;
            font-size: 9pt;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--m365a-medium-gray);
        }
        .dash-panel-details {
            display: flex;
            flex-direction: column;
            gap: 0;
        }
        .score-detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid var(--m365a-border);
        }
        .score-detail-row:last-child { border-bottom: none; }
        .score-detail-label {
            font-size: 10pt;
            color: var(--m365a-medium-gray);
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .score-detail-value {
            font-size: 16pt;
            font-weight: 700;
            color: var(--m365a-dark);
        }
        .score-detail-max {
            font-size: 11pt;
            font-weight: 400;
            color: var(--m365a-medium-gray);
        }
        .score-delta { font-size: 9pt; }
        .score-delta .score-detail-value { font-size: 11pt; }
        .success-text { color: var(--m365a-success); }
        .warning-text { color: var(--m365a-warning); }
        .danger-text { color: var(--m365a-danger); }

        /* Horizontal bar chart */
        .hbar-chart {
            display: flex;
            height: 28px;
            border-radius: 6px;
            overflow: hidden;
            margin: 12px 0;
            background: var(--m365a-border);
        }
        .hbar-segment {
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            transition: width 0.4s ease;
        }
        .hbar-label {
            font-size: 8pt;
            font-weight: 600;
            color: #fff;
            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        .hbar-pass { background: var(--m365a-success); }
        .hbar-fail { background: var(--m365a-danger); }
        .hbar-warning { background: var(--m365a-warning); }
        .hbar-review { background: var(--m365a-accent); }
        .hbar-unknown { background: var(--m365a-medium-gray); }
        .hbar-legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; font-size: 9pt; color: var(--m365a-medium-gray); }
        .hbar-legend-item { display: inline-flex; align-items: center; gap: 5px; }
        .compliance-status-bar { padding: 16px 20px; background: var(--m365a-light-gray); border: 1px solid var(--m365a-border); border-radius: 8px; margin: 16px 0; }
        .compliance-bar-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .compliance-bar-title { font-weight: 600; font-size: 10pt; color: var(--m365a-dark); }
        .compliance-bar-total { font-size: 9pt; color: var(--m365a-medium-gray); }

        /* Identity donut stack (MFA & SSPR side-by-side in dashboard) */
        .id-donut-stack {
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .id-donut-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            background: var(--m365a-card-bg);
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
        }
        .id-donut-chart { flex-shrink: 0; }
        .id-donut-info { min-width: 0; }
        .id-donut-title {
            font-size: 10pt;
            font-weight: 600;
            color: var(--m365a-dark);
        }
        .id-donut-detail {
            font-size: 8.5pt;
            color: var(--m365a-medium-gray);
            margin-top: 2px;
        }
        /* Color-coded identity metric cards */
        .id-metric-danger { border-left: 3px solid var(--m365a-danger); }
        .id-metric-danger .email-metric-value { color: var(--m365a-danger); }
        .id-metric-success { border-left: 3px solid var(--m365a-success); }
        .id-metric-success .email-metric-value { color: var(--m365a-success); }
        .id-metric-warning { border-left: 3px solid var(--m365a-warning); }
        .id-metric-warning .email-metric-value { color: var(--m365a-warning); }

        /* ----------------------------------------------------------
           Score Progress Bar
           ---------------------------------------------------------- */
        .score-bar-track {
            background: var(--m365a-border);
            border-radius: 8px;
            height: 12px;
            margin: 0 0 20px 0;
            overflow: hidden;
        }

        .score-bar-fill {
            height: 100%;
            border-radius: 8px;
        }
        .score-bar-fill.success { background: var(--m365a-success); }
        .score-bar-fill.warning { background: var(--m365a-warning); }
        .score-bar-fill.danger { background: var(--m365a-danger); }

        /* ----------------------------------------------------------
           Executive Summary
           ---------------------------------------------------------- */
        .exec-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 25px 0;
        }

        .stat-card {
            background: var(--m365a-light-gray);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            border-top: 3px solid var(--m365a-primary);
        }
        .stat-card .stat-value {
            font-size: 28pt;
            font-weight: bold;
            color: var(--m365a-dark);
        }

        .stat-card .stat-label {
            font-size: 10pt;
            color: var(--m365a-medium-gray);
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-top: 5px;
        }

        .stat-card .stat-detail {
            font-size: 8.5pt;
            color: var(--m365a-medium-gray);
            margin-top: 3px;
        }

        .stat-card .stat-value-sm { font-size: 18pt; }

        .stat-card.success { border-top-color: var(--m365a-success); }
        .stat-card.success .stat-value { color: var(--m365a-success); }
        .stat-card.warning { border-top-color: var(--m365a-warning); }
        .stat-card.warning .stat-value { color: var(--m365a-warning); }
        .stat-card.danger { border-top-color: var(--m365a-danger); }
        .stat-card.danger .stat-value { color: var(--m365a-danger); }
        .stat-card.error { border-top-color: var(--m365a-primary); }
        .stat-card.info { border-top-color: var(--m365a-accent); }

        /* ----------------------------------------------------------
           Email Dashboard (combined overview)
           ---------------------------------------------------------- */
        .email-dashboard {
            margin: 20px 0;
            padding: 24px;
            background: var(--m365a-light-gray);
            border: 1px solid var(--m365a-border);
            border-radius: 10px;
        }
        .email-dash-top {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
        }
        .email-dash-col { min-width: 0; }
        .email-dash-heading {
            font-size: 10pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--m365a-medium-gray);
            margin-bottom: 14px;
            padding-bottom: 8px;
            border-bottom: 2px solid var(--m365a-border);
        }
        .source-badge {
            display: inline-block;
            font-size: 0.65rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 0.15em 0.5em;
            border-radius: 3px;
            vertical-align: middle;
            margin-left: 0.5rem;
        }
        .source-exo {
            background: var(--m365a-accent, #0078d4);
            color: #fff;
        }
        .source-dns {
            background: #6c757d;
            color: #fff;
        }
        .email-dash-dns {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--m365a-border);
        }
        .dns-stats-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 10px;
            margin-top: 12px;
        }
        /* Compact 2-column grid for DNS stats inside a dashboard column */
        .dns-stats-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 8px;
        }
        .dns-stats-col .dns-stat {
            padding: 8px 6px;
        }
        .dns-stats-col .dns-stat-value {
            font-size: 12pt;
        }
        /* Email Policies — responsive grid below the 3-column dashboard row */
        .email-dash-policies {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--m365a-border);
        }
        .policy-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 10px;
            margin-top: 8px;
        }
        .dns-stat {
            text-align: center;
            padding: 12px 8px;
            background: var(--m365a-card-bg);
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
            border-top: 3px solid var(--m365a-primary);
        }
        .dns-stat.success { border-top-color: var(--m365a-success); }
        .dns-stat.warning { border-top-color: var(--m365a-warning); }
        .dns-stat.danger { border-top-color: var(--m365a-danger); }
        .dns-stat-value {
            font-size: 16pt;
            font-weight: bold;
            color: var(--m365a-dark);
        }
        .dns-stat.success .dns-stat-value { color: var(--m365a-success); }
        .dns-stat.warning .dns-stat-value { color: var(--m365a-warning); }
        .dns-stat.danger .dns-stat-value { color: var(--m365a-danger); }
        .dns-stat-label {
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 4px;
        }
        .dns-stat-detail {
            font-size: 7.5pt;
            color: var(--m365a-medium-gray);
            margin-top: 2px;
        }
        .dkim-mismatch {
            background: var(--m365a-dkim-warn-bg);
            color: var(--m365a-dkim-warn-text);
            font-weight: 600;
            padding: 0.15em 0.5em;
            border-radius: 3px;
            font-size: 0.85rem;
        }
        .dkim-exo-confirmed {
            background: var(--m365a-dkim-ok-bg);
            color: var(--m365a-dkim-ok-text);
            font-weight: 600;
            padding: 0.15em 0.5em;
            border-radius: 3px;
            font-size: 0.85rem;
        }
        .dns-protocols {
            margin-top: 12px;
        }
        .dns-protocols summary {
            font-size: 9pt;
            font-weight: 600;
            color: var(--m365a-accent);
            cursor: pointer;
            padding: 6px 0;
        }
        .dns-protocols summary:hover { text-decoration: underline; }
        .dns-protocols-body {
            font-size: 9pt;
            color: var(--m365a-medium-gray);
            line-height: 1.6;
            padding: 10px 0;
        }
        .dns-protocols-body p { margin: 6px 0; }
        .dns-protocols-body code {
            background: var(--m365a-border);
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 8.5pt;
        }
        .dns-protocols-body a { color: var(--m365a-accent); text-decoration: none; }
        .dns-protocols-body a:hover { text-decoration: underline; }

        /* Mailbox metrics within dashboard */
        .email-metrics-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        .hybrid-env-grid {
            grid-template-columns: 1fr;
        }
        .email-metric-card {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            background: var(--m365a-card-bg);
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
        }
        .email-metric-icon {
            font-size: 18pt;
            line-height: 1;
            flex-shrink: 0;
        }
        .email-metric-body { min-width: 0; }
        .email-metric-value {
            font-size: 16pt;
            font-weight: bold;
            color: var(--m365a-dark);
            line-height: 1.1;
        }
        .email-metric-label {
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 1px;
        }
        .email-metric-sublabel {
            font-size: 7.5pt;
            color: var(--m365a-medium-gray);
            font-style: italic;
            margin-top: 1px;
        }

        /* Dashboard card hover — subtle highlight for presentations */
        .email-metric-card,
        .id-donut-item,
        .policy-card,
        .dns-stat {
            transition: background 0.15s ease, border-color 0.15s ease;
        }
        .email-metric-card:hover,
        .id-donut-item:hover,
        .policy-card:hover,
        .dns-stat:hover {
            background: var(--m365a-hover-bg);
            border-color: var(--m365a-accent);
        }

        /* EXO donut panel within dashboard */
        .email-dash-col .dash-panel {
            border: none;
            padding: 0;
            background: transparent;
        }

        /* Policy cards within dashboard */
        .policy-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .policy-card {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
            background: var(--m365a-card-bg);
        }
        .policy-card.policy-enabled {
            border-left: 4px solid var(--m365a-success);
        }
        .policy-card.policy-disabled {
            border-left: 4px solid var(--m365a-danger);
        }
        .policy-status-badge {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12pt;
            font-weight: bold;
            flex-shrink: 0;
        }
        .policy-enabled .policy-status-badge {
            background: var(--m365a-success-bg);
            color: var(--m365a-success);
        }
        .policy-disabled .policy-status-badge {
            background: var(--m365a-danger-bg);
            color: var(--m365a-danger);
        }
        .policy-info { flex: 1; min-width: 0; }
        .policy-name {
            font-size: 9.5pt;
            font-weight: 600;
            color: var(--m365a-dark);
        }
        .policy-detail {
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            margin-top: 1px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .policy-status-label {
            font-size: 8.5pt;
            font-weight: 600;
            flex-shrink: 0;
        }
        .policy-enabled .policy-status-label { color: var(--m365a-success); }
        .policy-disabled .policy-status-label { color: var(--m365a-danger); }

        .cis-disclaimer {
            background: var(--m365a-info-bg);
            border-left: 3px solid var(--m365a-accent);
            padding: 15px;
            margin: 15px 0;
            border-radius: 6px;
            font-size: 9.5pt;
            color: var(--m365a-medium-gray);
        }
        .cis-disclaimer strong { color: var(--m365a-dark); }
        .cis-disclaimer p { margin: 8px 0 0 0; }

        /* ----------------------------------------------------------
           Section Advisory Blocks
           ---------------------------------------------------------- */
        .section-advisory {
            background: var(--m365a-light-gray);
            border-left: 3px solid var(--m365a-accent);
            padding: 15px 18px;
            margin: 12px 0 8px 0;
            border-radius: 0 6px 6px 0;
            font-size: 9.5pt;
            color: var(--m365a-medium-gray);
            line-height: 1.5;
        }
        .section-advisory strong { color: var(--m365a-dark); }
        .section-advisory p { margin: 6px 0; }
        .section-advisory code {
            background: var(--m365a-border);
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 9pt;
        }
        .section-advisory .advisory-links {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px solid var(--m365a-border);
            font-size: 8.5pt;
        }
        .section-advisory .advisory-links a {
            color: var(--m365a-accent);
            text-decoration: none;
        }
        .section-advisory .advisory-links a:hover { text-decoration: underline; }

        /* ----------------------------------------------------------
           Tables
           ---------------------------------------------------------- */
        .table-wrapper {
            overflow-x: auto;
            margin: 15px 0;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5pt;
            margin: 10px 0;
        }

        .summary-table { margin-bottom: 25px; }

        /* Collector chip grid — compact status display */
        .collector-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin: 4px 0 10px 0;
        }

        .collector-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px 5px 10px;
            border-radius: 6px;
            font-size: 8.5pt;
            background: var(--m365a-light-gray);
            border: 1px solid var(--m365a-border);
            line-height: 1.3;
            max-width: 480px;
        }

        .chip-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .chip-complete .chip-dot { background: var(--m365a-success); }
        .chip-skipped .chip-dot  { background: var(--m365a-medium-gray); }
        .chip-failed .chip-dot   { background: var(--m365a-danger); }

        .chip-name {
            font-weight: 500;
            color: var(--m365a-text);
            white-space: nowrap;
        }

        .chip-count {
            font-variant-numeric: tabular-nums;
            font-weight: 600;
            color: var(--m365a-medium-gray);
            margin-left: 2px;
        }

        .chip-count::before { content: '\00B7\00A0'; }

        .chip-note {
            font-size: 7.5pt;
            color: var(--m365a-danger);
            max-width: 280px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
            transition: max-width 0.2s ease, white-space 0.2s ease;
        }
        .chip-note.expanded {
            max-width: none;
            white-space: normal;
            word-break: break-word;
        }

        th {
            background: var(--m365a-dark);
            color: var(--m365a-white);
            padding: 10px 12px;
            text-align: left;
            font-weight: 600;
            font-size: 9pt;
            border-right: 1px solid rgba(255,255,255,0.2);
        }

        th:last-child { border-right: none; }

        td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--m365a-border);
            vertical-align: top;
        }

        tr:nth-child(even) { background: var(--m365a-light-gray); }
        tr:hover { background: var(--m365a-hover-bg); }

        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .notes { color: var(--m365a-medium-gray); font-size: 9pt; }
        .truncated { color: var(--m365a-medium-gray); font-size: 9pt; font-style: italic; margin-top: 5px; }

        /* ----------------------------------------------------------
           Badges
           ---------------------------------------------------------- */
        .badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 8.5pt;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .badge-complete { background: var(--m365a-success-bg); color: var(--m365a-success-text); }
        .badge-success { background: var(--m365a-success-bg); color: var(--m365a-success-text); }
        .badge-skipped { background: var(--m365a-skipped-bg); color: var(--m365a-skipped-text); }
        .badge-failed { background: var(--m365a-danger-bg); color: var(--m365a-danger-text); }
        .badge-warning { background: var(--m365a-warning-bg); color: var(--m365a-warning-text); }
        .badge-review { background: #ede9fe; color: #5b21b6; }
        .badge-info { background: var(--m365a-info-bg); color: var(--m365a-info-text); }
        .badge-neutral { background-color: var(--m365a-neutral-bg); color: var(--m365a-neutral); }
        .badge-critical { background: var(--m365a-critical-bg); color: var(--m365a-critical-text); }

        /* ----------------------------------------------------------
           Section
           ---------------------------------------------------------- */
        .section {
            margin-bottom: 30px;
            page-break-inside: avoid;
        }

        /* Collapsible sections */
        details.section {
            border: 1px solid var(--m365a-border);
            border-radius: 6px;
            padding: 0 20px 0 20px;
        }

        details.section > summary {
            cursor: pointer;
            list-style: none;
            user-select: none;
        }

        details.section > summary::-webkit-details-marker { display: none; }

        details.section > summary h2 {
            position: relative;
            padding-right: 30px;
        }

        details.section > summary h2::after {
            content: '\25B6';
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            font-size: 10pt;
            color: var(--m365a-medium-gray);
            transition: transform 0.2s;
        }

        details[open].section > summary h2::after {
            transform: translateY(-50%) rotate(90deg);
        }

        details[open].section {
            padding-bottom: 20px;
        }

        .data-table td {
            max-width: 300px;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }

        /* Sortable column headers */
        .data-table th {
            cursor: pointer;
            user-select: none;
            transition: background 0.15s ease;
        }

        .data-table th:hover { background: var(--m365a-dark-gray); }

        .data-table th::after {
            content: ' \2195';
            opacity: 0.3;
            font-size: 8pt;
        }

        .data-table th.sort-asc::after {
            content: ' \25B2';
            opacity: 0.8;
        }

        .data-table th.sort-desc::after {
            content: ' \25BC';
            opacity: 0.8;
        }

        /* DNS subsection divider */
        .dns-subsection-divider {
            margin: 2rem 0 1rem;
            padding: 0.75rem 1rem;
            border-left: 4px solid var(--m365a-accent);
            background: var(--m365a-card-bg);
            border: 1px solid var(--m365a-border);
            border-left: 4px solid var(--m365a-accent);
            border-radius: 0 6px 6px 0;
        }
        .dns-subsection-divider h3 {
            margin: 0 0 0.25rem;
            font-size: 1.05rem;
            color: var(--m365a-text);
        }
        .dns-subsection-divider .source-note {
            font-size: 0.85rem;
            color: var(--m365a-medium-gray);
            margin: 0;
        }

        /* Collapsible data sub-sections */
        .collector-detail {
            margin: 15px 0;
            border: 1px solid var(--m365a-border);
            border-radius: 4px;
        }

        .collector-detail > summary {
            cursor: pointer;
            list-style: none;
            padding: 8px 15px;
            background: var(--m365a-light-gray);
            border-radius: 4px;
            user-select: none;
        }

        .collector-detail > summary::-webkit-details-marker { display: none; }

        .collector-detail > summary h3 {
            display: inline;
            margin: 0;
            position: relative;
            padding-right: 24px;
        }

        .collector-detail > summary h3::after {
            content: '\25B6';
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            transition: transform 0.2s;
        }

        .collector-detail[open] > summary h3::after {
            transform: translateY(-50%) rotate(90deg);
        }

        .collector-detail[open] > summary {
            border-radius: 4px 4px 0 0;
            border-bottom: 1px solid var(--m365a-border);
        }

        .row-count {
            font-weight: normal;
            color: var(--m365a-medium-gray);
            font-size: 9pt;
        }

        /* Scrollable data tables — compact by default, expandable on demand */
        .collector-detail .table-wrapper {
            max-height: 260px;
            overflow-y: auto;
            overflow-x: auto;
        }
        .collector-detail .table-wrapper.expanded { max-height: none; }
        .table-expand-btn { display: flex; align-items: center; justify-content: center; gap: 5px; width: 100%; padding: 6px 0; border: 1px solid var(--m365a-accent); border-top: none; border-radius: 0 0 4px 4px; background: var(--m365a-hover-bg); color: var(--m365a-accent); cursor: pointer; font-size: 0.82em; font-weight: 500; text-align: center; transition: background 0.15s, color 0.15s; letter-spacing: 0.02em; }
        .table-expand-btn:hover { background: var(--m365a-accent); color: #fff; }

        .collector-detail .data-table thead th {
            position: sticky;
            top: 0;
            z-index: 1;
        }

        /* CIS Compliance */
        .cis-table .cis-id {
            font-family: 'Consolas', 'Courier New', monospace;
            font-weight: 700;
            color: var(--m365a-dark);
            white-space: nowrap;
        }

        .cis-table .remediation-cell {
            font-size: 9pt;
            color: var(--m365a-medium-gray);
            max-width: 350px;
        }

        .copy-btn { background: none; border: none; cursor: pointer; padding: 2px 4px; font-size: 0.85em; opacity: 0.5; transition: opacity 0.15s; vertical-align: middle; margin-left: 4px; }
        .copy-btn:hover { opacity: 1; }
        .copy-btn.copied { opacity: 1; }

        .cis-row-pass { border-left: 3px solid var(--m365a-success); background-color: var(--m365a-success-bg); }
        .cis-row-fail { border-left: 3px solid var(--m365a-danger); background-color: var(--m365a-danger-bg); }
        .cis-row-warning { border-left: 3px solid var(--m365a-warning); background-color: var(--m365a-warning-bg); }
        .cis-row-review { border-left: 3px solid var(--m365a-accent); background-color: var(--m365a-info-bg); }
        .cis-row-info { border-left: 3px solid var(--m365a-neutral); background-color: var(--m365a-neutral-bg); }
        .cis-row-unknown { border-left: 3px solid var(--m365a-medium-gray); background-color: var(--m365a-light-gray); }

        /* Zebra striping for security config tables — subtle overlay on status colors */
        .cis-row-pass:nth-child(even),
        .cis-row-fail:nth-child(even),
        .cis-row-warning:nth-child(even),
        .cis-row-review:nth-child(even),
        .cis-row-info:nth-child(even),
        .cis-row-unknown:nth-child(even) {
            background-image: linear-gradient(rgba(0,0,0,0.06), rgba(0,0,0,0.06));
        }

        /* Framework cross-reference tags */
        .framework-refs { white-space: normal; max-width: 260px; }
        .fw-tag { display: inline-block; padding: 1px 5px; margin: 1px; border-radius: 3px; font-size: 0.72em; font-family: 'Consolas', 'Courier New', monospace; }
        .fw-cis    { background: #e8f0fe; color: #1a56db; }
        .fw-cis-l2 { background: #dbeafe; color: #1e40af; }
        .fw-nist   { background: #e8f0fe; color: #1a56db; }
        .fw-nist-high { background: #dbeafe; color: #1e40af; }
        .fw-nist-privacy { background: #ede9fe; color: #5b21b6; }
        .fw-csf   { background: #fef3c7; color: #92400e; }
        .fw-iso   { background: #ecfdf5; color: #065f46; }
        .fw-stig  { background: #f3e8ff; color: #6b21a8; }
        .fw-entra-stig { background: #eef2ff; color: #3730a3; }
        .fw-pci   { background: #fef2f2; color: #991b1b; }
        .fw-cmmc  { background: #f0fdfa; color: #134e4a; }
        .fw-hipaa { background: #fdf2f8; color: #9d174d; }
        .fw-scuba { background: #fff7ed; color: #9a3412; }
        .fw-soc2  { background: #eff6ff; color: #1e3a5f; }
        .fw-fedramp { background: #fef3c7; color: #78350f; }
        .fw-essential8, .fw-e8 { background: #fef9c3; color: #713f12; }
        .fw-mitre { background: #fef2f2; color: #7f1d1d; }
        .fw-cisv8, .fw-cis-ctrl { background: #e0f2fe; color: #0c4a6e; }
        .fw-default { background: #e2e8f0; color: #334155; }
        .fw-profile-tag { display: inline-block; padding: 0 3px; margin-left: 2px; border-radius: 2px; font-size: 0.68em; background: rgba(0,0,0,0.06); color: inherit; vertical-align: middle; }
        .fw-unmapped { color: var(--m365a-border); font-size: 0.85em; }

        /* Framework multi-selector */
        .fw-selector { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 10px 14px; margin: 12px 0; background: var(--m365a-light-gray); border: 1px solid var(--m365a-border); border-radius: 6px; }
        .fw-selector-label { font-weight: 600; font-size: 0.85em; color: var(--m365a-dark); margin-right: 4px; }
        .fw-checkbox { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--m365a-border); border-radius: 4px; font-size: 0.82em; cursor: pointer; transition: all 0.15s; background: var(--m365a-card-bg); user-select: none; }
        .fw-checkbox:hover { background: var(--m365a-hover-bg); border-color: var(--m365a-accent); }
        .fw-checkbox.active { background: var(--m365a-dark); color: #fff; border-color: var(--m365a-dark); }
        .fw-checkbox input[type="checkbox"] { display: none; }
        .fw-selector-actions { margin-left: auto; display: flex; gap: 4px; }
        .fw-action-btn { padding: 3px 10px; border: 1px solid var(--m365a-border); border-radius: 3px; background: var(--m365a-card-bg); cursor: pointer; font-size: 0.78em; color: var(--m365a-medium-gray); }
        .fw-action-btn:hover { background: var(--m365a-hover-bg); }

        /* Status filter */
        .status-filter { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 14px; margin: 0 0 12px; background: var(--m365a-light-gray); border: 1px solid var(--m365a-border); border-radius: 6px; }
        .status-filter-label { font-weight: 600; font-size: 0.85em; color: var(--m365a-dark); margin-right: 4px; }
        .status-checkbox { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--m365a-border); border-radius: 4px; font-size: 0.82em; cursor: pointer; transition: all 0.15s; background: var(--m365a-card-bg); user-select: none; }
        .status-checkbox:hover { border-color: var(--m365a-accent); }
        .status-checkbox input[type="checkbox"] { display: none; }
        .status-fail.active { background: #fef2f2; color: #991b1b; border-color: #fca5a5; font-weight: 600; }
        .status-warning.active { background: #fffbeb; color: #92400e; border-color: #fcd34d; font-weight: 600; }
        .status-review.active { background: #f0f9ff; color: #1e40af; border-color: #93c5fd; font-weight: 600; }
        .status-pass.active { background: #ecfdf5; color: #065f46; border-color: #6ee7b7; font-weight: 600; }
        .status-info.active { background: #f3f4f6; color: #4b5563; border-color: #9ca3af; font-weight: 600; }
        .status-unknown.active { background: #f9fafb; color: #6b7280; border-color: #d1d5db; font-weight: 600; }

        /* Info status explanation note */
        .info-note-inline { display: inline-flex; align-items: center; gap: 4px; font-size: 0.75em; color: var(--m365a-medium-gray); margin-left: 8px; }

        /* Dual-metric framework cards */
        .coverage-bar { margin-top: 6px; background: var(--m365a-border); border-radius: 4px; height: 6px; overflow: hidden; }
        .coverage-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
        .fw-card.success .coverage-fill { background: var(--m365a-success); }
        .fw-card.warning .coverage-fill { background: var(--m365a-warning); }
        .fw-card.danger .coverage-fill { background: var(--m365a-danger); }
        .stat-sublabel { font-size: 0.75em; color: var(--m365a-medium-gray); }
        .coverage-label { font-size: 0.65em; color: var(--m365a-medium-gray); margin-top: 2px; }

        /* Profile level breakdown (L1/L2 sub-metrics in framework cards) */
        .profile-level-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 0.75em; }
        .profile-level-label { font-weight: 600; min-width: 20px; color: var(--m365a-dark); }
        .profile-level-detail { color: var(--m365a-medium-gray); font-size: 0.9em; }

        /* Section filter */
        .section-filter { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 14px; margin: 0 0 12px; background: var(--m365a-light-gray); border: 1px solid var(--m365a-border); border-radius: 6px; }
        .section-filter-label { font-weight: 600; font-size: 0.85em; color: var(--m365a-dark); margin-right: 4px; }
        .section-checkbox { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--m365a-border); border-radius: 4px; font-size: 0.82em; cursor: pointer; transition: all 0.15s; background: var(--m365a-card-bg); user-select: none; }
        .section-checkbox:hover { border-color: var(--m365a-accent); }
        .section-checkbox.active { background: #0d9488; color: #fff; border-color: #0d9488; }
        .section-checkbox input[type="checkbox"] { display: none; }
        .no-results { text-align: center; padding: 40px; color: var(--m365a-medium-gray); font-style: italic; }

        /* Compact scan header (shown when exec summary is skipped) */
        .scan-header {
            background: var(--m365a-card-bg); border: 1px solid var(--m365a-border);
            border-radius: 8px; padding: 16px 20px; margin-bottom: 16px;
        }
        .scan-header-title { font-size: 1.3em; font-weight: 600; color: var(--m365a-text); }
        .scan-header-meta {
            display: flex; flex-wrap: wrap; gap: 6px 16px;
            margin-top: 6px; font-size: 0.88em; color: var(--m365a-medium-gray);
        }
        .scan-header-meta span:not(:last-child)::after {
            content: '\00b7'; margin-left: 16px; color: var(--m365a-border);
        }
        .scan-header-sections {
            margin-top: 8px; font-size: 0.82em; color: var(--m365a-medium-gray);
        }

        /* Global expand/collapse controls */
        .report-controls {
            display: flex; gap: 8px; justify-content: flex-end;
            position: sticky; top: 0; z-index: 50;
            padding: 8px 12px; margin: 0 -20px 12px -20px;
            background: var(--m365a-card-bg); border-bottom: 1px solid var(--m365a-border);
        }
        .report-ctrl-btn {
            padding: 5px 14px; border: 1px solid var(--m365a-border); border-radius: 4px;
            background: var(--m365a-bg); cursor: pointer; font-size: 0.82em;
            color: var(--m365a-text); transition: background 0.15s;
        }
        .report-ctrl-btn:hover { background: var(--m365a-hover-bg); }

        /* Per-section expand/collapse buttons */
        .matrix-controls { display: flex; gap: 6px; margin: 8px 0; }

        /* Matrix table */
        .matrix-table td { vertical-align: top; }
        .matrix-table tbody tr:nth-child(even) { background: transparent; }
        .matrix-table tbody tr.stripe-even td { background-color: rgba(148, 163, 184, 0.12); }
        .matrix-table tbody tr:hover td { background-color: transparent; }
        /* Severity-tinted hover — shared by data-table (section tables) and matrix-table.
           Uses full status color (vs muted -bg base) for the "different tone" shift.
           opacity removed: it fades text + badges, hurting contrast. color:#fff is explicit. */
        .data-table tr.cis-row-pass:hover,
        .matrix-table tbody tr.cis-row-pass:hover    { background-color: var(--m365a-success); color: #fff; }
        .data-table tr.cis-row-fail:hover,
        .matrix-table tbody tr.cis-row-fail:hover    { background-color: var(--m365a-danger);  color: #fff; }
        .data-table tr.cis-row-warning:hover,
        .matrix-table tbody tr.cis-row-warning:hover { background-color: var(--m365a-warning); color: #fff; }
        .data-table tr.cis-row-review:hover,
        .matrix-table tbody tr.cis-row-review:hover  { background-color: var(--m365a-accent);  color: #fff; }
        .data-table tr.cis-row-info:hover,
        .matrix-table tbody tr.cis-row-info:hover    { background-color: var(--m365a-neutral); color: #fff; }
        .data-table tr.cis-row-unknown:hover,
        .matrix-table tbody tr.cis-row-unknown:hover { background-color: var(--m365a-medium-gray); color: #fff; }
        /* Remediation Action Plan table severity hover */
        .remediation-table tr.remediation-row-critical:hover { background-color: var(--m365a-danger);  color: #fff; }
        .remediation-table tr.remediation-row-high:hover     { background-color: var(--m365a-warning); color: #fff; }
        .remediation-table tr.remediation-row-medium:hover   { background-color: var(--m365a-info);    color: #fff; }
        .remediation-table tr.remediation-row-low:hover      { background-color: var(--m365a-neutral); color: #fff; }
        .matrix-table .framework-refs { max-width: 180px; }

        /* ----------------------------------------------------------
           Theme Toggle
           ---------------------------------------------------------- */
        .theme-toggle {
            position: fixed; top: 16px; right: 16px; z-index: 1000;
            background: var(--m365a-card-bg); border: 1px solid var(--m365a-border);
            border-radius: 50%; width: 44px; height: 44px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2); transition: all 0.3s ease;
            font-size: 18px; line-height: 1; padding: 0;
        }
        body.dark-theme .theme-toggle {
            background: #E2E8F0; border-color: #CBD5E1;
            box-shadow: 0 2px 12px rgba(0,0,0,0.5);
            color: #1E293B;
        }
        .theme-toggle:hover { transform: scale(1.1); }
        body:not(.dark-theme) .theme-icon-dark { display: none; }
        body.dark-theme .theme-icon-light { display: none; }

        /* ----------------------------------------------------------
           Dark Theme Selector Overrides
           (CSS variables handle most colors; these fix elements
            with hardcoded colors or inverted semantics)
           ---------------------------------------------------------- */
        body.dark-theme th {
            background: #1E3A5F;
            color: #E2E8F0;
            border-right: 1px solid rgba(255,255,255,0.15);
        }
        body.dark-theme th:last-child { border-right: none; }
        body.dark-theme .data-table th:hover { background: #254E78; }

        /* Badge colors now handled via CSS variables in :root / body.dark-theme */
        body.dark-theme .badge-neutral { background-color: var(--m365a-neutral-bg); color: var(--m365a-neutral); }
        body.dark-theme .badge-review  { background: #3b0764; color: #c4b5fd; }

        body.dark-theme .fw-cis    { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .fw-cis-l2 { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-nist   { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .fw-nist-high { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-nist-privacy { background: #2E1065; color: #C4B5FD; }
        body.dark-theme .fw-csf    { background: #78350F; color: #FCD34D; }
        body.dark-theme .fw-iso    { background: #064E3B; color: #6EE7B7; }
        body.dark-theme .fw-stig   { background: #3B0764; color: #C4B5FD; }
        body.dark-theme .fw-entra-stig { background: #312E81; color: #A5B4FC; }
        body.dark-theme .fw-pci    { background: #7F1D1D; color: #FCA5A5; }
        body.dark-theme .fw-cmmc   { background: #134E4A; color: #5EEAD4; }
        body.dark-theme .fw-hipaa  { background: #831843; color: #F9A8D4; }
        body.dark-theme .fw-scuba  { background: #7C2D12; color: #FDBA74; }
        body.dark-theme .fw-soc2   { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-fedramp { background: #78350F; color: #FCD34D; }
        body.dark-theme .fw-essential8, body.dark-theme .fw-e8 { background: #422006; color: #FDE68A; }
        body.dark-theme .fw-mitre { background: #7F1D1D; color: #FCA5A5; }
        body.dark-theme .fw-cisv8, body.dark-theme .fw-cis-ctrl { background: #0C4A6E; color: #7DD3FC; }
        body.dark-theme .fw-default { background: #334155; color: #CBD5E1; }
        body.dark-theme .fw-profile-tag { background: rgba(255,255,255,0.1); }

        /* Cloud badge colors now handled via CSS variables in :root / body.dark-theme */

        body.dark-theme .fw-checkbox.active { background: #3B82F6; color: #ffffff; border-color: #3B82F6; }
        body.dark-theme .section-checkbox.active { background: #0d9488; color: #ffffff; border-color: #0d9488; }
        body.dark-theme .matrix-table tbody tr[class*="cis-row-"]:hover { color: #1a1a1a; }
        body.dark-theme .matrix-table tbody tr[class*="cis-row-"]:hover .badge { color: #1a1a1a; }
        body.dark-theme .status-fail.active { background: #7F1D1D; color: #FCA5A5; border-color: #991B1B; }
        body.dark-theme .status-warning.active { background: #78350F; color: #FCD34D; border-color: #92400E; }
        body.dark-theme .status-review.active { background: #1E3A5F; color: #93C5FD; border-color: #1E40AF; }
        body.dark-theme .status-pass.active { background: #064E3B; color: #6EE7B7; border-color: #065F46; }
        body.dark-theme .status-info.active { background: #374151; color: #9ca3af; border-color: #6b7280; }
        body.dark-theme .status-unknown.active { background: #334155; color: #94A3B8; border-color: #475569; }

        body.dark-theme .cis-disclaimer { background: #1E293B; }
        body.dark-theme .section-advisory code { background: #334155; color: #E2E8F0; }

        body.dark-theme .cover-page {
            background-color: #1E293B;
            color: #F1F5F9;
        }
        body.dark-theme .cover-title { color: #F1F5F9; }
        body.dark-theme .cover-subtitle { color: #E2E8F0; }
        body.dark-theme .cover-tenant { color: #60A5FA; }
        body.dark-theme .cover-date { color: #94A3B8; opacity: 1; }

        /* ----------------------------------------------------------
           Footer
           ---------------------------------------------------------- */
        .report-footer {
            margin-top: 50px;
            padding: 20px 0;
            border-top: 2px solid var(--m365a-border);
            text-align: center;
            color: var(--m365a-medium-gray);
            font-size: 9pt;
        }

        .report-footer .m365a-name {
            color: var(--m365a-primary);
            font-weight: 600;
            text-decoration: none;
        }
        .report-footer .m365a-name:hover {
            text-decoration: underline;
        }

        /* ----------------------------------------------------------
           Appendix
           ---------------------------------------------------------- */
        .appendix-section { page-break-before: always; margin-top: 40px; }
        .appendix-section h2 { color: var(--m365a-dark); border-bottom: 2px solid var(--m365a-border); padding-bottom: 8px; }
        .appendix-desc { color: var(--m365a-medium-gray); font-size: 9pt; margin-bottom: 16px; }
        .appendix-count { color: var(--m365a-medium-gray); font-size: 9pt; margin-top: 12px; font-style: italic; }
        .appendix-index-col { width: 36px; min-width: 36px; text-align: center; color: var(--m365a-medium-gray); font-variant-numeric: tabular-nums; }

        /* ----------------------------------------------------------
           Focus Styles
           ---------------------------------------------------------- */
        a:focus-visible, .theme-toggle:focus-visible, .data-table th:focus-visible {
            outline: 2px solid var(--m365a-accent);
            outline-offset: 2px;
        }

        /* ----------------------------------------------------------
           Paginated Navigation Layout
           ---------------------------------------------------------- */
        .report-layout {
            display: flex;
            min-height: 100vh;
        }
        .report-nav {
            position: sticky;
            top: 0;
            width: 250px;
            min-width: 250px;
            height: 100vh;
            overflow-y: auto;
            background: var(--m365a-card-bg);
            border-right: 1px solid var(--m365a-border);
            padding: 0;
            z-index: 100;
            flex-shrink: 0;
        }
        .nav-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 14px 16px 12px;
            border-bottom: 1px solid var(--m365a-border);
            position: sticky;
            top: 0;
            background: var(--m365a-card-bg);
            z-index: 1;
        }
        .nav-title { font-weight: 600; font-size: 11pt; flex-grow: 1; color: var(--m365a-text); text-decoration: none; }
        .nav-title:hover { color: var(--m365a-accent); }
        .nav-subtitle { display: block; font-size: 7pt; font-weight: 400; color: var(--m365a-medium-gray); text-transform: uppercase; letter-spacing: 0.5px; line-height: 1; margin-top: 1px; }
        .nav-toggle {
            display: none;
            background: var(--m365a-card-bg);
            border: 1px solid var(--m365a-border);
            border-radius: 4px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 16px;
            color: var(--m365a-text);
            line-height: 1;
        }
        .nav-show-all {
            font-size: 8pt;
            padding: 4px 10px;
            border-radius: 4px;
            border: 1px solid var(--m365a-border);
            background: var(--m365a-card-bg);
            color: var(--m365a-text);
            cursor: pointer;
            white-space: nowrap;
            transition: background 0.15s, border-color 0.15s;
        }
        .nav-show-all:hover {
            background: var(--m365a-hover-bg);
            border-color: var(--m365a-accent);
        }
        .nav-show-all.active-toggle {
            background: var(--m365a-accent);
            color: #fff;
            border-color: var(--m365a-accent);
        }
        .nav-theme-btn {
            background: var(--m365a-card-bg);
            border: 1px solid var(--m365a-border);
            border-radius: 4px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 14px;
            line-height: 1;
            color: var(--m365a-text);
            transition: background 0.15s;
        }
        .nav-theme-btn:hover { background: var(--m365a-hover-bg); }
        body:not(.dark-theme) .nav-theme-dark { display: none; }
        body.dark-theme .nav-theme-light { display: none; }
        .nav-list { list-style: none; padding: 8px 0; margin: 0; }
        .nav-item a {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            color: var(--m365a-text);
            text-decoration: none;
            font-size: 9.5pt;
            border-left: 3px solid transparent;
            transition: background 0.15s, border-color 0.15s;
        }
        .nav-item a:hover { background: var(--m365a-hover-bg); }
        .nav-item.active a {
            border-left-color: var(--m365a-accent);
            background: var(--m365a-hover-bg);
            font-weight: 600;
        }
        .nav-icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            opacity: 0.7;
            vertical-align: -2px;
        }
        .nav-item.active .nav-icon { opacity: 1; }
        .nav-item-muted a { opacity: 0.6; }
        .nav-item-muted a:hover { opacity: 1; }
        .nav-badge {
            margin-left: auto;
            font-size: 8pt;
            padding: 1px 6px;
            border-radius: 8px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .nav-badge-pass { background: var(--m365a-success-bg); color: var(--m365a-success-text); }
        .nav-badge-fail { background: var(--m365a-danger-bg); color: var(--m365a-danger-text); }
        .nav-badge-warn { background: var(--m365a-warning-bg); color: var(--m365a-warning-text); }
        .nav-badge-info { background: var(--m365a-info-bg); color: var(--m365a-info-text); }
        .nav-badge-neutral { background: var(--m365a-neutral-bg); color: var(--m365a-neutral); }
        .nav-badge-skip { background: var(--m365a-light-gray); color: var(--m365a-medium-gray); font-weight: 400; font-style: italic; }
        .nav-separator {
            height: 1px;
            background: var(--m365a-border);
            margin: 6px 16px;
        }

        /* Page visibility */
        .report-page { display: none; }
        .report-page.page-active { display: block; }
        .report-layout.show-all-mode .report-page { display: block; }

        /* Hide global expand/collapse in paginated mode -- each section has its own */
        .report-layout:not(.show-all-mode) .report-controls { display: none; }
        /* Force sections open in paginated mode -- collapsing makes no sense with one page */
        .report-layout:not(.show-all-mode) .section[open] > summary,
        .report-layout:not(.show-all-mode) details.section { pointer-events: auto; }
        .report-layout:not(.show-all-mode) details.section > summary::after { display: none; }

        /* Content takes remaining width */
        .report-layout .content {
            flex: 1;
            min-width: 0;
            max-width: 100%;
        }

        /* Mobile hamburger overlay */
        .nav-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            z-index: 999;
        }
        .nav-overlay.nav-overlay-active { display: block; }

        @media (max-width: 768px) {
            .report-nav {
                position: fixed;
                left: -270px;
                top: 0;
                transition: left 0.3s ease;
                z-index: 1000;
                box-shadow: none;
            }
            .report-nav.nav-open {
                left: 0;
                box-shadow: 2px 0 12px rgba(0,0,0,0.25);
            }
            .nav-toggle {
                display: flex;
                align-items: center;
                justify-content: center;
                position: fixed;
                top: 12px;
                left: 12px;
                z-index: 998;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            }
            .report-layout .content { width: 100%; }
        }

        /* ----------------------------------------------------------
           Value Opportunity
           ---------------------------------------------------------- */
        .value-hero {
            display: flex;
            align-items: center;
            gap: 24px;
            padding: 20px;
            background: var(--m365a-card-bg);
            border-radius: 8px;
            border: 1px solid var(--m365a-border);
            margin-bottom: 20px;
        }
        .value-hero-donut {
            flex-shrink: 0;
        }
        .value-hero-stats {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
        }
        .value-stat-card {
            text-align: center;
            padding: 12px 20px;
            background: var(--m365a-neutral-bg);
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
            min-width: 100px;
        }
        .value-stat-value {
            font-size: 20pt;
            font-weight: 700;
            color: var(--m365a-accent);
        }
        .value-stat-label {
            font-size: 8pt;
            text-transform: uppercase;
            color: var(--m365a-medium-gray);
            margin-top: 4px;
        }
        .value-hero-summary {
            font-size: 10pt;
            color: var(--m365a-medium-gray);
            margin-top: 8px;
        }
        .value-categories {
            margin-bottom: 20px;
        }
        .value-category-row {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 6px 0;
        }
        .value-category-label {
            width: 160px;
            font-size: 9pt;
            font-weight: 600;
            flex-shrink: 0;
        }
        .value-category-bar {
            flex: 1;
            height: 18px;
            background: var(--m365a-border);
            border-radius: 4px;
            display: flex;
            overflow: hidden;
        }
        .value-bar-fill {
            height: 100%;
            transition: width 0.3s;
        }
        .value-bar-adopted { background: var(--m365a-success); }
        .value-bar-partial { background: var(--m365a-warning); }
        .value-bar-gap { background: var(--m365a-danger); }
        .value-category-pct {
            width: 45px;
            text-align: right;
            font-size: 9pt;
            font-weight: 600;
        }
        .value-roadmap-section {
            margin-bottom: 16px;
        }
        .value-learn-link {
            color: var(--m365a-accent);
            text-decoration: none;
            font-size: 8.5pt;
        }
        .value-learn-link:hover { text-decoration: underline; }
        @media (max-width: 768px) {
            .value-hero { flex-direction: column; }
            .value-category-label { width: 120px; }
        }

        /* ----------------------------------------------------------
           Print Styles
           ---------------------------------------------------------- */
        @media print {
            .data-table { page-break-inside: avoid; }
            .section { page-break-inside: avoid; }
            body { font-size: 9pt; }
            .theme-toggle { display: none; }
            .report-nav { display: none; }
            .nav-toggle { display: none !important; }
            .nav-overlay { display: none !important; }
            .report-page { display: block !important; }
            .report-layout { display: block; }

            /* --- Fix 6: Force light theme for print --- */
            body.dark-theme {
                --m365a-primary: #2563EB;
                --m365a-dark-primary: #1D4ED8;
                --m365a-accent: #60A5FA;
                --m365a-dark: #0F172A;
                --m365a-dark-gray: #1E293B;
                --m365a-medium-gray: #64748B;
                --m365a-light-gray: #F1F5F9;
                --m365a-border: #CBD5E1;
                --m365a-white: #ffffff;
                --m365a-body-bg: #ffffff;
                --m365a-text: #1E293B;
                --m365a-card-bg: #ffffff;
                --m365a-hover-bg: #e8f4f8;
                --m365a-success: #2ecc71;
                --m365a-warning: #f39c12;
                --m365a-danger: #e74c3c;
                --m365a-info: #3498db;
                --m365a-success-bg: #d4edda;
                --m365a-warning-bg: #fff3cd;
                --m365a-danger-bg: #f8d7da;
                --m365a-info-bg: #d1ecf1;
            }

            .hero-banner { display: none; }
            .cover-print-only { display: flex !important; }
            .cover-page {
                min-height: auto;
                height: 100vh;
                page-break-after: always;
            }
            .cover-branding-link { color: rgba(255,255,255,0.5); }

            .content { padding: 20px 30px; }

            h1 { font-size: 18pt; margin-top: 20px; }
            h2 { font-size: 14pt; margin-top: 20px; }

            /* --- Fix 4: Table header repetition and spacing --- */
            thead { display: table-header-group; }
            thead th { position: static !important; }
            table { font-size: 8pt; }
            th { padding: 6px 8px; }
            td { padding: 5px 8px; }

            /* --- Fix 7: Tighten compliance framework cards --- */
            .exec-summary { grid-template-columns: repeat(4, 1fr); gap: 12px; }
            .stat-card { padding: 12px; }
            .stat-value { font-size: 22pt; }

            /* --- Fix 1: Switch dashboards to 2-column grid --- */
            .email-dashboard { page-break-inside: auto; padding: 12px; }
            .email-dash-top { grid-template-columns: 1fr 1fr; page-break-inside: auto; }
            .email-metrics-grid { grid-template-columns: 1fr; }

            /* --- Fix 2: Scale down donut SVGs --- */
            .donut-chart { max-width: 100px; height: auto; }
            .dash-panel-donut .donut-chart { max-width: 90px; }
            .id-donut-chart .donut-chart { max-width: 80px; }

            /* --- Fix 5: Reduce spacing and padding for print density --- */
            .email-metric-card { padding: 6px 8px; gap: 6px; }
            .email-metric-icon { font-size: 14pt; }
            .email-metric-value { font-size: 12pt; }
            .email-metric-label { font-size: 7pt; }
            .score-detail-value { font-size: 12pt; }
            .score-detail-label { font-size: 8pt; }
            .id-donut-item { padding: 6px 8px; gap: 8px; }
            .id-donut-title { font-size: 8pt; }
            .id-donut-detail { font-size: 7pt; }
            .dash-panel { gap: 10px; padding: 10px; }
            .dns-stat { padding: 8px 4px; }
            .dns-stat-value { font-size: 12pt; }
            .policy-card { padding: 6px 10px; }

            .dns-stats-row { grid-template-columns: repeat(6, 1fr); }
            .dns-stats-col { grid-template-columns: 1fr 1fr; gap: 6px; }
            .dns-stats-col .dns-stat { padding: 4px 3px; }
            .dns-stats-col .dns-stat-value { font-size: 10pt; }
            .policy-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
            .email-dash-policies { margin-top: 12px; padding-top: 10px; }
            .dns-protocols { display: block; }
            .dns-protocols-body { display: block; }
            .chart-panel { page-break-inside: avoid; }

            /* --- Fix 3: Allow dashboards to break across pages --- */
            .id-donut-stack { page-break-inside: auto; }
            .exec-hero { page-break-inside: avoid; page-break-after: always; grid-template-columns: 1fr 1fr; }
            .service-area-chart { page-break-inside: avoid; border-color: #ccc; }
            .tenant-card { page-break-inside: avoid; }
            .tenant-facts { grid-template-columns: repeat(3, 1fr); }
            .tenant-meta { font-size: 8pt; }
            .domain-tag { font-size: 8pt; padding: 2px 6px; }

            /* --- Section / details expansion for print --- */
            .section { page-break-inside: auto; }
            details.section { border: none; padding: 0; }
            details.section > summary { pointer-events: none; }
            details.section > summary h2::after { display: none; }
            details:not([open]) > *:not(summary) { display: block !important; }
            .collector-detail { border: none; }
            .collector-detail > summary {
                pointer-events: none;
                background: none;
                border: none;
                page-break-after: avoid;
            }
            .collector-detail > summary h3::after { display: none; }
            .collector-detail .table-wrapper { max-height: none !important; overflow: visible !important; }
            .data-table th::after { display: none; }
            .data-table { page-break-inside: auto; }
            tr { page-break-inside: avoid; }
            .report-controls { display: none; }
            .fw-selector { display: none; }
            .status-filter { display: none; }
            .section-filter { display: none; }
            .col-picker-bar { display: none; }
            .csv-export-btn { display: none; }
            .table-expand-btn { display: none; }
            .matrix-controls { display: none; }
            .callout-row { display: block; }
            .matrix-table tr { display: table-row !important; }
            .fw-col { display: table-cell !important; }

            /* --- Callouts: expand and simplify for print --- */
            .section-toolbar { display: none; }
            .callout-accordion { border: none; }
            .callout-accordion-title { pointer-events: none; }
            .callout-accordion-title::before { content: ''; }
            .callout-tabs { border: none; }
            .tab-header { display: none; }
            .tab-panel { display: block !important; padding: 4px 14px; }
            .tab-panel::before { content: attr(aria-labelledby); font-weight: 600; display: block; margin-bottom: 4px; }
            .callout { border-left-width: 3px; page-break-inside: avoid; }

            /* --- Fix 8: Hide hover effects in print --- */
            .email-metric-card:hover,
            .id-donut-item:hover,
            .policy-card:hover,
            .dns-stat:hover { background: inherit; border-color: inherit; }
            tr:hover { background: inherit; }
            .dash-panel.donut-hover-active .donut-fill { opacity: 1; }
            .score-detail-row.donut-highlight { background: inherit; }
            .copy-btn { display: none; }

            /* --- Value Opportunity print --- */
            .value-hero { break-inside: avoid; }
            .value-category-bar { print-color-adjust: exact; -webkit-print-color-adjust: exact; }

            @page {
                size: letter;
                margin: 0.75in;
            }

            @page :first {
                margin: 0;
            }
        }

        /* --------------------------------------------------------
           Remediation Action Plan page
           -------------------------------------------------------- */
        /* Stat tiles */
        .remediation-stats { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0 1.25rem; }
        .remediation-stat { display: flex; flex-direction: column; align-items: center; padding: 0.75rem 1.5rem; border-radius: 8px; min-width: 90px; text-align: center; cursor: default; }
        .stat-num { font-size: 2rem; font-weight: 700; line-height: 1; }
        .stat-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 0.3rem; font-weight: 600; }
        .remediation-stat-critical { background: var(--m365a-danger-bg); color: var(--m365a-danger-text); }
        .remediation-stat-high     { background: var(--m365a-warning-bg); color: var(--m365a-warning-text); }
        .remediation-stat-medium   { background: var(--m365a-info-bg); color: var(--m365a-info-text); }
        .remediation-stat-low      { background: var(--m365a-neutral-bg); color: var(--m365a-medium-gray); }
        /* Chip filter bar */
        .remediation-chip-bar { display: flex; flex-direction: column; gap: 6px; margin-bottom: 1rem; padding: 10px 14px; background: var(--m365a-light-gray); border: 1px solid var(--m365a-border); border-radius: 6px; }
        .rem-chip-section { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
        .rem-chip-group { display: flex; flex-wrap: wrap; gap: 6px; }
        .rem-filter-label { font-size: 0.82em; font-weight: 600; color: var(--m365a-medium-gray); white-space: nowrap; margin-right: 2px; min-width: 60px; }
        .rem-chip-count { font-size: 0.85em; font-weight: 700; }
        /* Severity chip active colors (override fw-checkbox.active for severity) */
        .rem-sev-chip.active[data-severity='Critical'] { background: var(--m365a-danger);  color: #fff; border-color: var(--m365a-danger); }
        .rem-sev-chip.active[data-severity='High']     { background: var(--m365a-warning); color: #fff; border-color: var(--m365a-warning); }
        .rem-sev-chip.active[data-severity='Medium']   { background: var(--m365a-info);    color: #fff; border-color: var(--m365a-info); }
        .rem-sev-chip.active[data-severity='Low']      { background: var(--m365a-neutral); color: #fff; border-color: var(--m365a-neutral); }
        /* Row severity border */
        .remediation-table tr.remediation-row-critical td:first-child { border-left: 4px solid var(--m365a-danger); }
        .remediation-table tr.remediation-row-high td:first-child     { border-left: 4px solid var(--m365a-warning); }
        .remediation-table tr.remediation-row-medium td:first-child   { border-left: 4px solid var(--m365a-info); }
        .remediation-table tr.remediation-row-low td:first-child      { border-left: 4px solid var(--m365a-neutral); }
        .remediation-row-critical { background-color: var(--m365a-danger-bg); }
        .remediation-row-high     { background-color: var(--m365a-warning-bg); }
        .remediation-row-medium   { background-color: var(--m365a-info-bg); }
        .remediation-row-low      { background-color: var(--m365a-neutral-bg); }
        .remediation-row-critical:nth-child(even),
        .remediation-row-high:nth-child(even),
        .remediation-row-medium:nth-child(even),
        .remediation-row-low:nth-child(even) {
            background-image: linear-gradient(rgba(0,0,0,0.06), rgba(0,0,0,0.06));
        }
        /* Remediation table — taller compact view than the standard 260px */
        .remediation-table-wrapper { max-height: 380px; }
        .remediation-empty { font-size: 0.875rem; color: var(--m365a-medium-gray); padding: 1rem 0; }
        /* Header row: severity tiles + section bar chart */
        .remediation-header-row { display: flex; align-items: flex-start; gap: 1.5rem; flex-wrap: wrap; }
        .remediation-header-row .remediation-stats { margin-bottom: 0; flex-shrink: 0; }
        .remediation-section-chart { flex: 1; min-width: 200px; padding: 0.5rem 0 0.5rem 1.5rem; border-left: 1px solid var(--m365a-border); align-self: center; }
        .section-chart-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; color: var(--m365a-medium-gray); margin-bottom: 0.6rem; }
        .section-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
        .section-bar-row:last-child { margin-bottom: 0; }
        .section-bar-label { font-size: 0.8rem; color: var(--m365a-text); min-width: 100px; white-space: nowrap; }
        .section-bar-track { flex: 1; height: 8px; background: var(--m365a-border); border-radius: 4px; overflow: hidden; }
        .section-bar-fill { height: 100%; background: var(--m365a-primary); border-radius: 4px; }
        .section-bar-count { font-size: 0.8rem; font-weight: 700; color: var(--m365a-text); min-width: 24px; text-align: right; }
        /* Column picker — lives inside .status-filter flex container */
        .col-picker-bar { position: relative; display: inline-block; }
        .col-picker-toggle { padding: 4px 10px; border: 1px solid var(--m365a-border); border-radius: 4px; background: var(--m365a-card-bg); color: var(--m365a-medium-gray); cursor: pointer; font-size: 0.82em; }
        .col-picker-toggle:hover { background: var(--m365a-hover-bg); color: var(--m365a-text); }
        .col-picker-panel { position: absolute; top: 100%; left: 0; z-index: 10; min-width: 160px; padding: 8px; background: var(--m365a-card-bg); border: 1px solid var(--m365a-border); border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .col-picker-item { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 0.85em; cursor: pointer; white-space: nowrap; }
        .col-picker-item input { cursor: pointer; }
        /* CSV export button — in control bar, accent color */
        .csv-export-btn { padding: 4px 10px; border: 1px solid var(--m365a-accent); border-radius: 4px; background: var(--m365a-card-bg); color: var(--m365a-accent); cursor: pointer; font-size: 0.82em; font-weight: 500; white-space: nowrap; }
        .csv-export-btn:hover { background: var(--m365a-accent); color: #fff; }
    </style>
$accentCss
</head>
<body>
    <a href="#main-content" class="skip-nav">Skip to main content</a>

    <!-- Mobile nav overlay -->
    <div class="nav-overlay" id="navOverlay"></div>
    <!-- Mobile hamburger toggle (positioned fixed on small screens) -->
    <button class="nav-toggle" id="navToggleMobile" aria-label="Toggle navigation">&#9776;</button>

    <!-- Paginated Layout -->
    <div class="report-layout" id="reportLayout">
        <nav class="report-nav" id="reportNav" role="navigation" aria-label="Report sections">
            <div class="nav-header">
                <a href="https://github.com/Galvnyz/M365-Assess" target="_blank" rel="noopener" class="nav-title">M365 Assess<span class="nav-subtitle">repo</span></a>
                <button class="nav-show-all" id="navShowAll" title="Toggle between paginated and scrollable view">Show All</button>
                <button class="nav-theme-btn" id="navThemeToggle" aria-label="Toggle dark mode" title="Toggle light/dark mode">
                    <span class="nav-theme-light">&#9788;</span>
                    <span class="nav-theme-dark">&#9790;</span>
                </button>
            </div>
            <ul class="nav-list" id="navList">
"@

# Microsoft Fluent UI System Icons (Regular 20px, MIT licensed)
# Source: https://github.com/microsoft/fluentui-system-icons
$navIcons = @{
    'overview'            = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M8.9975 2.38811C9.56767 1.87584 10.4323 1.87584 11.0025 2.38811L16.5025 7.32965C16.8191 7.61414 17 8.01977 17 8.44544V15.4996C17 16.328 16.3284 16.9996 15.5 16.9996H13C12.1716 16.9996 11.5 16.328 11.5 15.4996V11.9996C11.5 11.7234 11.2761 11.4996 11 11.4996H9C8.72386 11.4996 8.5 11.7234 8.5 11.9996V15.4996C8.5 16.328 7.82843 16.9996 7 16.9996H4.5C3.67157 16.9996 3 16.328 3 15.4996V8.44544C3 8.01977 3.18086 7.61414 3.4975 7.32965L8.9975 2.38811ZM10.3342 3.13197C10.1441 2.96122 9.85589 2.96122 9.66583 3.13197L4.16583 8.07351C4.06029 8.16834 4 8.30355 4 8.44544V15.4996C4 15.7757 4.22386 15.9996 4.5 15.9996H7C7.27614 15.9996 7.5 15.7757 7.5 15.4996V11.9996C7.5 11.1711 8.17157 10.4996 9 10.4996H11C11.8284 10.4996 12.5 11.1711 12.5 11.9996V15.4996C12.5 15.7757 12.7239 15.9996 13 15.9996H15.5C15.7761 15.9996 16 15.7757 16 15.4996V8.44544C16 8.30355 15.9397 8.16834 15.8342 8.07351L10.3342 3.13197Z"/></svg>'
    'identity'            = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2C7.79086 2 6 3.79086 6 6C6 8.20914 7.79086 10 10 10C12.2091 10 14 8.20914 14 6C14 3.79086 12.2091 2 10 2ZM7 6C7 4.34315 8.34315 3 10 3C11.6569 3 13 4.34315 13 6C13 7.65685 11.6569 9 10 9C8.34315 9 7 7.65685 7 6ZM5.00873 11C3.90315 11 3 11.8869 3 13C3 14.6912 3.83281 15.9663 5.13499 16.7966C6.41697 17.614 8.14526 18 10 18C11.8547 18 13.583 17.614 14.865 16.7966C16.1672 15.9663 17 14.6912 17 13C17 11.8956 16.1045 11 15 11L5.00873 11ZM4 13C4 12.4467 4.44786 12 5.00873 12L15 12C15.5522 12 16 12.4478 16 13C16 14.3088 15.3777 15.2837 14.3274 15.9534C13.2568 16.636 11.7351 17 10 17C8.26489 17 6.74318 16.636 5.67262 15.9534C4.62226 15.2837 4 14.3088 4 13Z"/></svg>'
    'licensing'           = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M4 3C2.89543 3 2 3.89543 2 5V8.67133C2.28512 8.31899 2.62236 8.01056 3 7.75777V5C3 4.44772 3.44772 4 4 4H16C16.5523 4 17 4.44772 17 5V13C17 13.5523 16.5523 14 16 14H9.24223C9.16639 14.1133 9.08554 14.223 9 14.3287V15H16C17.1046 15 18 14.1046 18 13V5C18 3.89543 17.1046 3 16 3H4ZM5 6.5C5 6.22386 5.22386 6 5.5 6H14.5C14.7761 6 15 6.22386 15 6.5C15 6.77614 14.7761 7 14.5 7H5.5C5.22386 7 5 6.77614 5 6.5ZM5.5 15C3.567 15 2 13.433 2 11.5C2 9.567 3.567 8 5.5 8C7.433 8 9 9.567 9 11.5C9 13.433 7.433 15 5.5 15ZM3 15.2422C3.71505 15.7209 4.57493 16 5.5 16C6.42507 16 7.28495 15.7209 8 15.2422V18C8 18.412 7.52962 18.6472 7.2 18.4L5.8 17.35C5.62222 17.2167 5.37778 17.2167 5.2 17.35L3.8 18.4C3.47038 18.6472 3 18.412 3 18V15.2422ZM10.5 10C10.2239 10 10 10.2239 10 10.5C10 10.7761 10.2239 11 10.5 11H14.5C14.7761 11 15 10.7761 15 10.5C15 10.2239 14.7761 10 14.5 10H10.5Z"/></svg>'
    'email'               = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M15.5 4C16.8807 4 18 5.11929 18 6.5V14.5C18 15.8807 16.8807 17 15.5 17H4.5C3.11929 17 2 15.8807 2 14.5V6.5C2 5.11929 3.11929 4 4.5 4H15.5ZM17 7.961L10.2535 11.931C10.1231 12.0077 9.96661 12.0205 9.82751 11.9693L9.74649 11.931L3 7.963V14.5C3 15.3284 3.67157 16 4.5 16H15.5C16.3284 16 17 15.3284 17 14.5V7.961ZM15.5 5H4.5C3.67157 5 3 5.67157 3 6.5V6.802L10 10.9199L17 6.801V6.5C17 5.67157 16.3284 5 15.5 5Z"/></svg>'
    'intune'              = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M9 14C8.72386 14 8.5 14.2239 8.5 14.5C8.5 14.7761 8.72386 15 9 15H11C11.2761 15 11.5 14.7761 11.5 14.5C11.5 14.2239 11.2761 14 11 14H9ZM7 2C5.89543 2 5 2.89543 5 4V16C5 17.1046 5.89543 18 7 18H13C14.1046 18 15 17.1046 15 16V4C15 2.89543 14.1046 2 13 2H7ZM6 4C6 3.44772 6.44772 3 7 3H13C13.5523 3 14 3.44772 14 4V16C14 16.5523 13.5523 17 13 17H7C6.44772 17 6 16.5523 6 16V4Z"/></svg>'
    'security'            = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M9.72265 2.08397C9.8906 1.97201 10.1094 1.97201 10.2774 2.08397C12.2155 3.3761 14.3117 4.1823 16.5707 4.50503C16.817 4.54021 17 4.75117 17 5V9.5C17 13.3913 14.693 16.2307 10.1795 17.9667C10.064 18.0111 9.93605 18.0111 9.82051 17.9667C5.30699 16.2307 3 13.3913 3 9.5V5C3 4.75117 3.18296 4.54021 3.42929 4.50503C5.68833 4.1823 7.78446 3.3761 9.72265 2.08397ZM9.59914 3.34583C7.85275 4.39606 5.98541 5.09055 4 5.42787V9.5C4 12.892 5.96795 15.3634 10 16.9632C14.0321 15.3634 16 12.892 16 9.5V5.42787C14.0146 5.09055 12.1473 4.39606 10.4009 3.34583L10 3.09715L9.59914 3.34583Z"/></svg>'
    'collaboration'       = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3C9.17157 3 8.5 3.67157 8.5 4.5C8.5 5.32843 9.17157 6 10 6C10.8284 6 11.5 5.32843 11.5 4.5C11.5 3.67157 10.8284 3 10 3ZM7.5 4.5C7.5 3.11929 8.61929 2 10 2C11.3807 2 12.5 3.11929 12.5 4.5C12.5 5.88071 11.3807 7 10 7C8.61929 7 7.5 5.88071 7.5 4.5ZM15.5 4C14.9477 4 14.5 4.44772 14.5 5C14.5 5.55228 14.9477 6 15.5 6C16.0523 6 16.5 5.55228 16.5 5C16.5 4.44772 16.0523 4 15.5 4ZM13.5 5C13.5 3.89543 14.3954 3 15.5 3C16.6046 3 17.5 3.89543 17.5 5C17.5 6.10457 16.6046 7 15.5 7C14.3954 7 13.5 6.10457 13.5 5ZM3.5 5C3.5 4.44772 3.94772 4 4.5 4C5.05228 4 5.5 4.44772 5.5 5C5.5 5.55228 5.05228 6 4.5 6C3.94772 6 3.5 5.55228 3.5 5ZM4.5 3C3.39543 3 2.5 3.89543 2.5 5C2.5 6.10457 3.39543 7 4.5 7C5.60457 7 6.5 6.10457 6.5 5C6.5 3.89543 5.60457 3 4.5 3ZM7.25 8C6.55964 8 6 8.55964 6 9.25V14C6 16.2091 7.79086 18 10 18C12.2091 18 14 16.2091 14 14V9.25C14 8.55964 13.4404 8 12.75 8H7.25ZM7 9.25C7 9.11193 7.11193 9 7.25 9H12.75C12.8881 9 13 9.11193 13 9.25V14C13 15.6569 11.6569 17 10 17C8.34315 17 7 15.6569 7 14V9.25Z"/></svg>'
    'hybrid'              = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M11.4142 3.63503C11.6095 3.43977 11.6095 3.12319 11.4142 2.92792L9.29289 0.806603C9.09763 0.611341 8.78104 0.611341 8.58578 0.806603C8.39052 1.00186 8.39052 1.31845 8.58578 1.51371L9.58264 2.51056C7.80518 2.60911 6.05488 3.33754 4.69671 4.6957C1.76776 7.62463 1.76776 12.3734 4.69671 15.3023C4.95359 15.5592 5.2247 15.7937 5.50757 16.0058C5.72852 16.1714 6.04191 16.1266 6.20756 15.9057C6.3732 15.6847 6.32838 15.3713 6.10743 15.2057C5.86235 15.0219 5.6271 14.8185 5.40382 14.5952C2.8654 12.0568 2.8654 7.94121 5.40382 5.40281C6.68997 4.11666 8.38002 3.48223 10.0664 3.49934C10.0915 3.49959 10.1162 3.49799 10.1404 3.49466L8.58578 5.04924C8.39052 5.24451 8.39052 5.56109 8.58578 5.75635C8.78104 5.95161 9.09763 5.95161 9.29289 5.75635L11.4142 3.63503ZM8.58578 16.363C8.39052 16.5582 8.39052 16.8748 8.58578 17.0701L10.7071 19.1914C10.9024 19.3866 11.219 19.3866 11.4142 19.1914C11.6095 18.9961 11.6095 18.6795 11.4142 18.4843L10.4174 17.4874C12.1948 17.3889 13.9451 16.6605 15.3033 15.3023C18.2322 12.3734 18.2322 7.62462 15.3033 4.69569C15.0464 4.43881 14.7753 4.20428 14.4924 3.99221C14.2715 3.82656 13.9581 3.87139 13.7924 4.09233C13.6268 4.31327 13.6716 4.62667 13.8926 4.79231C14.1377 4.97606 14.3729 5.17952 14.5962 5.40279C17.1346 7.9412 17.1346 12.0568 14.5962 14.5952C13.31 15.8813 11.62 16.5158 9.9336 16.4987C9.90849 16.4984 9.88379 16.5 9.85963 16.5033L11.4142 14.9487C11.6095 14.7535 11.6095 14.4369 11.4142 14.2416C11.219 14.0464 10.9024 14.0464 10.7071 14.2416L8.58578 16.363Z"/></svg>'
    'inventory'           = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M4 5C4 3.993 4.87513 3.24472 5.90401 2.77705C6.97802 2.28886 8.42664 2 10 2C11.5734 2 13.022 2.28886 14.096 2.77705C15.1249 3.24472 16 3.993 16 5V15C16 16.007 15.1249 16.7553 14.096 17.2229C13.022 17.7111 11.5734 18 10 18C8.42664 18 6.97802 17.7111 5.90401 17.2229C4.87513 16.7553 4 16.007 4 15V5ZM5 5C5 5.37372 5.35608 5.87543 6.31781 6.31258C7.23441 6.72922 8.53579 7 10 7C11.4642 7 12.7656 6.72922 13.6822 6.31258C14.6439 5.87543 15 5.37372 15 5C15 4.62628 14.6439 4.12457 13.6822 3.68742C12.7656 3.27078 11.4642 3 10 3C8.53579 3 7.23441 3.27078 6.31781 3.68742C5.35608 4.12457 5 4.62628 5 5ZM15 6.69813C14.729 6.90046 14.4201 7.07563 14.096 7.22295C13.022 7.71114 11.5734 8 10 8C8.42664 8 6.97802 7.71114 5.90401 7.22295C5.5799 7.07563 5.27105 6.90046 5 6.69813V15C5 15.3737 5.35608 15.8754 6.31781 16.3126C7.23441 16.7292 8.53579 17 10 17C11.4642 17 12.7656 16.7292 13.6822 16.3126C14.6439 15.8754 15 15.3737 15 15V6.69813Z"/></svg>'
    'soc2'                = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 1C12.2091 1 14 2.79086 14 5V7.0498C15.1411 7.28142 16 8.29051 16 9.5V15.5C16 16.8807 14.8807 18 13.5 18H6.5C5.11929 18 4 16.8807 4 15.5V9.5C4 8.29051 4.85886 7.28142 6 7.0498V5C6 2.79086 7.79086 1 10 1ZM6.5 8C5.67157 8 5 8.67157 5 9.5V15.5C5 16.3284 5.67157 17 6.5 17H13.5C14.3284 17 15 16.3284 15 15.5V9.5C15 8.67157 14.3284 8 13.5 8H6.5ZM10 11.5C10.5523 11.5 11 11.9477 11 12.5C11 13.0523 10.5523 13.5 10 13.5C9.44772 13.5 9 13.0523 9 12.5C9 11.9477 9.44772 11.5 10 11.5ZM10 2C8.34315 2 7 3.34315 7 5V7H13V5C13 3.34315 11.6569 2 10 2Z"/></svg>'
    'powerbi'             = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M5 3C3.89543 3 3 3.89543 3 5V15C3 16.1046 3.89543 17 5 17C6.10457 17 7 16.1046 7 15V5C7 3.89543 6.10457 3 5 3ZM4 5C4 4.44772 4.44772 4 5 4C5.55228 4 6 4.44772 6 5V15C6 15.5523 5.55228 16 5 16C4.44772 16 4 15.5523 4 15V5ZM8 8C8 6.89543 8.89543 6 10 6C11.1046 6 12 6.89543 12 8V15C12 16.1046 11.1046 17 10 17C8.89543 17 8 16.1046 8 15V8ZM10 7C9.44772 7 9 7.44772 9 8V15C9 15.5523 9.44772 16 10 16C10.5523 16 11 15.5523 11 15V8C11 7.44772 10.5523 7 10 7ZM13 11C13 9.89543 13.8954 9 15 9C16.1046 9 17 9.89543 17 11V15C17 16.1046 16.1046 17 15 17C13.8954 17 13 16.1046 13 15V11ZM15 10C14.4477 10 14 10.4477 14 11V15C14 15.5523 14.4477 16 15 16C15.5523 16 16 15.5523 16 15V11C16 10.4477 15.5523 10 15 10Z"/></svg>'
    'activedirectory'     = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M4.5 3C3.11929 3 2 4.11929 2 5.5V14.5C2 15.8807 3.11929 17 4.5 17H15.5C16.8807 17 18 15.8807 18 14.5V7.5C18 6.11929 16.8807 5 15.5 5H9.70711L8.21967 3.51256C7.89148 3.18437 7.44636 3 6.98223 3H4.5ZM3 5.5C3 4.67157 3.67157 4 4.5 4H6.98223C7.18115 4 7.37191 4.07902 7.51256 4.21967L8.79289 5.5L7.43934 6.85355C7.34557 6.94732 7.21839 7 7.08579 7H3V5.5ZM3 8H7.08579C7.48361 8 7.86514 7.84196 8.14645 7.56066L9.70711 6H15.5C16.3284 6 17 6.67157 17 7.5V14.5C17 15.3284 16.3284 16 15.5 16H4.5C3.67157 16 3 15.3284 3 14.5V8Z"/></svg>'
    'compliance overview' = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M6 3C4.34315 3 3 4.34315 3 6V14C3 15.6569 4.34315 17 6 17H14C15.6569 17 17 15.6569 17 14V6C17 4.34315 15.6569 3 14 3H6ZM4 6C4 4.89543 4.89543 4 6 4H14C15.1046 4 16 4.89543 16 6V14C16 15.1046 15.1046 16 14 16H6C4.89543 16 4 15.1046 4 14V6ZM13.3536 8.35355C13.5488 8.15829 13.5488 7.84171 13.3536 7.64645C13.1583 7.45118 12.8417 7.45118 12.6464 7.64645L9 11.2929L7.35355 9.64645C7.15829 9.45118 6.84171 9.45118 6.64645 9.64645C6.45118 9.84171 6.45118 10.1583 6.64645 10.3536L8.64645 12.3536C8.84171 12.5488 9.15829 12.5488 9.35355 12.3536L13.3536 8.35355Z"/></svg>'
    'framework catalogs'  = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3.49788C2 2.67062 2.67135 2 3.49951 2H4.49918C5.32733 2 5.99869 2.67062 5.99869 3.49788V16.4795C5.99869 17.3068 5.32733 17.9774 4.49918 17.9774H3.49951C2.67135 17.9774 2 17.3068 2 16.4795V3.49788ZM3.49951 2.99859C3.22346 2.99859 2.99967 3.22213 2.99967 3.49788V16.4795C2.99967 16.7552 3.22346 16.9788 3.49951 16.9788H4.49918C4.77523 16.9788 4.99901 16.7552 4.99901 16.4795V3.49788C4.99901 3.22213 4.77523 2.99859 4.49918 2.99859H3.49951ZM6.99836 3.49788C6.99836 2.67062 7.66971 2 8.49786 2H9.49754C10.3257 2 10.997 2.67062 10.997 3.49788V16.4795C10.997 17.3068 10.3257 17.9774 9.49754 17.9774H8.49786C7.66971 17.9774 6.99836 17.3068 6.99836 16.4795V3.49788ZM8.49786 2.99859C8.22181 2.99859 7.99803 3.22213 7.99803 3.49788V16.4795C7.99803 16.7552 8.22181 16.9788 8.49786 16.9788H9.49754C9.77359 16.9788 9.99737 16.7552 9.99737 16.4795V3.49788C9.99737 3.22213 9.77359 2.99859 9.49754 2.99859H8.49786ZM15.7179 6.15675C15.5259 5.32176 14.6733 4.81743 13.848 5.05077L13.1029 5.26146C12.3477 5.47502 11.8851 6.23427 12.0422 7.00249L14.046 16.8015C14.2174 17.6394 15.0551 18.1642 15.8848 17.9534L16.8698 17.7031C17.6592 17.5025 18.144 16.7091 17.9616 15.9162L15.7179 6.15675ZM14.1203 6.0116C14.3954 5.93382 14.6796 6.10193 14.7436 6.38026L16.9873 16.1397C17.0481 16.404 16.8865 16.6684 16.6234 16.7353L15.6384 16.9856C15.3618 17.0559 15.0826 16.8809 15.0255 16.6016L13.0216 6.80264C12.9693 6.54656 13.1234 6.29348 13.3752 6.22229L14.1203 6.0116Z"/></svg>'
    'technical issues'    = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M9.56195 3.26181C9.75109 2.91271 10.2521 2.91273 10.4412 3.26186L16.9418 15.2628C17.1222 15.5959 16.881 16.0009 16.5021 16.0009H3.49942C3.12051 16.0009 2.8793 15.5959 3.0598 15.2627L9.56195 3.26181ZM11.3205 2.78557C10.7532 1.73821 9.25014 1.73813 8.68271 2.78544L2.18056 14.7864C1.63905 15.7858 2.3627 17.0009 3.49942 17.0009H16.5021C17.6388 17.0009 18.3624 15.786 17.821 14.7865L11.3205 2.78557ZM10.5 7.50023C10.5 7.22409 10.2761 7.00023 9.99996 7.00023C9.72382 7.00023 9.49996 7.22409 9.49996 7.50023V11.5002C9.49996 11.7764 9.72382 12.0002 9.99996 12.0002C10.2761 12.0002 10.5 11.7764 10.5 11.5002V7.50023ZM10.75 13.7502C10.75 14.1644 10.4142 14.5002 9.99996 14.5002C9.58575 14.5002 9.24996 14.1644 9.24996 13.7502C9.24996 13.336 9.58575 13.0002 9.99996 13.0002C10.4142 13.0002 10.75 13.336 10.75 13.7502Z"/></svg>'
    'appendix'            = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M6 2C4.89543 2 4 2.89543 4 4V16C4 17.1046 4.89543 18 6 18H14C15.1046 18 16 17.1046 16 16V7.41421C16 7.01639 15.842 6.63486 15.5607 6.35355L11.6464 2.43934C11.3651 2.15804 10.9836 2 10.5858 2H6ZM5 4C5 3.44772 5.44772 3 6 3H10V6.5C10 7.32843 10.6716 8 11.5 8H15V16C15 16.5523 14.5523 17 14 17H6C5.44772 17 5 16.5523 5 16V4ZM14.7929 7H11.5C11.2239 7 11 6.77614 11 6.5V3.20711L14.7929 7Z"/></svg>'
    'remediation'         = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M11 2C11.5523 2 12 2.44772 12 3H13.5C14.3284 3 15 3.67157 15 4.5V15.5C15 16.3284 14.3284 17 13.5 17H6.5C5.67157 17 5 16.3284 5 15.5V4.5C5 3.67157 5.67157 3 6.5 3H8C8 2.44772 8.44772 2 9 2H11ZM9 3H8V4C8 4.55228 8.44772 5 9 5H11C11.5523 5 12 4.55228 12 4V3H11C11 3.55228 10.5523 4 10 4C9.44772 4 9 3.55228 9 3ZM13.3536 8.35355C13.5488 8.15829 13.5488 7.84171 13.3536 7.64645C13.1583 7.45118 12.8417 7.45118 12.6464 7.64645L9 11.2929L7.35355 9.64645C7.15829 9.45118 6.84171 9.45118 6.64645 9.64645C6.45118 9.84171 6.45118 10.1583 6.64645 10.3536L8.64645 12.3536C8.84171 12.5488 9.15829 12.5488 9.35355 12.3536L13.3536 8.35355Z"/></svg>'
}

# Pre-compute Hybrid sync status to decide nav placement (#415)
$hybridSyncEnabled = $false
$hybridNavItemHtml  = ''
$hybridCsvFile = Get-ChildItem -Path $AssessmentFolder -Filter '23-Hybrid-Sync.csv' -ErrorAction SilentlyContinue
if ($hybridCsvFile) {
    $hybridRow = Import-Csv -Path $hybridCsvFile.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hybridRow) {
        $hybridSyncEnabled = $hybridRow.OnPremisesSyncEnabled -eq 'True' -or $hybridRow.DirSyncConfigured -eq 'True'
    }
}

# Build sidebar nav items -- Overview combines cover + exec summary + org profile
$navIconOverview = $navIcons['overview']
$html += "                <li class='nav-item active' data-page='overview'><a href='#overview'>$navIconOverview Overview</a></li>`n"
$remActionableCount = @($allCisFindings | Where-Object { $_.Status -in @('Fail', 'Warning') }).Count
if ($remActionableCount -gt 0) {
    $navIconRemediation = $navIcons['remediation']
    $html += "                <li class='nav-item' data-page='remediation-plan'><a href='#remediation-plan'>$navIconRemediation Remediation Plan<span class='nav-badge nav-badge-fail'>$remActionableCount</span></a></li>`n"
}
foreach ($navSection in $sections) {
    # Tenant is merged into Overview page -- skip separate nav entry
    if ($navSection -eq 'Tenant') { continue }

    # Hybrid deferred to bottom when cloud-only (sync=Off) -- built and emitted after main loop
    if ($navSection -eq 'Hybrid' -and -not $hybridSyncEnabled) {
        $hybridPageId   = "section-hybrid"
        $hybridIconSvg  = if ($navIcons.ContainsKey('hybrid')) { $navIcons['hybrid'] } else { '' }
        $hybridNavItemHtml = "                <li class='nav-item nav-item-muted' data-page='$hybridPageId'><a href='#$hybridPageId'>$hybridIconSvg Hybrid<span class='nav-badge nav-badge-neutral'>Off</span></a></li>`n"
        continue
    }

    $navPageId = "section-$(($navSection -replace '[^a-zA-Z0-9]', '-').ToLower())"
    $navLabel = [System.Web.HttpUtility]::HtmlEncode($navSection)
    $navBadge = ''
    if ($sectionStatusCounts.ContainsKey($navSection)) {
        # Section has security findings -- show status badge
        $navCounts = $sectionStatusCounts[$navSection]
        if ($navCounts.Fail -gt 0) {
            $navBadge = "<span class='nav-badge nav-badge-fail'>$($navCounts.Fail)</span>"
        }
        elseif ($navCounts.Warning -gt 0) {
            $navBadge = "<span class='nav-badge nav-badge-warn'>$($navCounts.Warning)</span>"
        }
        elseif ($navCounts.Pass -gt 0) {
            $navBadge = "<span class='nav-badge nav-badge-pass'>&#10003;</span>"
        }
    }
    else {
        # No security findings -- use collector summary for context
        $sectionCollectors = @($summary | Where-Object { $_.Section -eq $navSection })
        if ($sectionCollectors.Count -gt 0) {
            $skippedAll = ($sectionCollectors | Where-Object { $_.Status -eq 'Skipped' }).Count -eq $sectionCollectors.Count
            if ($skippedAll) {
                $navBadge = "<span class='nav-badge nav-badge-skip'>skip</span>"
            }
            elseif ($navSection -eq 'Hybrid') {
                # Sync is On -- show active badge
                $navBadge = "<span class='nav-badge nav-badge-info'>On</span>"
            }
            else {
                $totalItems = ($sectionCollectors | Where-Object { $_.Status -eq 'Complete' } |
                    ForEach-Object { [int]$_.Items } | Measure-Object -Sum).Sum
                if ($totalItems -gt 0) {
                    $navBadge = "<span class='nav-badge nav-badge-neutral'>$totalItems</span>"
                }
            }
        }
    }
    $navIconKey = $navSection.ToLower()
    $navIconSvg = if ($navIcons.ContainsKey($navIconKey)) { $navIcons[$navIconKey] } else { '' }
    $html += "                <li class='nav-item' data-page='$navPageId'><a href='#$navPageId'>$navIconSvg $navLabel$navBadge</a></li>`n"
}

# Hybrid deferred to bottom of main nav when cloud-only
if ($hybridNavItemHtml) {
    $html += "                <li class='nav-separator' role='separator'></li>`n"
    $html += $hybridNavItemHtml
}

# Separator before extra sections
$hasExtraSections = ($complianceHtml) -or ($catalogHtml) -or ($valueOpportunityHtml) -or ($issues.Count -gt 0) -or ($allCisFindings.Count -gt 0)
if ($hasExtraSections) {
    $html += "                <li class='nav-separator' role='separator'></li>`n"
}
if ($complianceHtml) {
    $navIconCompliance = $navIcons['compliance overview']
    $html += "                <li class='nav-item' data-page='compliance-overview'><a href='#compliance-overview'>$navIconCompliance Compliance Overview</a></li>`n"
}
if ($catalogHtml) {
    $navIconCatalogs = $navIcons['framework catalogs']
    $html += "                <li class='nav-item' data-page='framework-catalogs'><a href='#framework-catalogs'>$navIconCatalogs Framework Catalogs</a></li>`n"
}
if ($valueOpportunityHtml) {
    $navIconValue = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2C10.5523 2 11 2.44772 11 3V5.26756C12.8135 5.61337 14.3866 6.69752 15.3698 8.22729L17.2346 7.14877C17.7124 6.87242 18.3207 7.03737 18.5971 7.51513C18.8734 7.99289 18.7085 8.60122 18.2307 8.87756L16.3752 9.95058C16.6244 10.6038 16.7609 11.3127 16.7609 12.0547C16.7609 15.7866 13.7318 18.8157 10 18.8157C6.26817 18.8157 3.23911 15.7866 3.23911 12.0547C3.23911 8.69614 5.7041 5.89989 8.91304 5.34845V3C8.91304 2.44772 9.36075 2 9.91304 2H10ZM10 7.29389C7.37282 7.29389 5.23911 9.42759 5.23911 12.0547C5.23911 14.6819 7.37282 16.8157 10 16.8157C12.6272 16.8157 14.7609 14.6819 14.7609 12.0547C14.7609 9.42759 12.6272 7.29389 10 7.29389Z"/></svg>'
    $html += "                <li class='nav-item' data-page='value-opportunity'><a href='#value-opportunity'>$navIconValue Value Opportunity</a></li>`n"
}
if ($issues.Count -gt 0) {
    $navIconIssues = $navIcons['technical issues']
    $html += "                <li class='nav-item' data-page='issues'><a href='#issues'>$navIconIssues Technical Issues</a></li>`n"
}
if ($allCisFindings.Count -gt 0) {
    $navIconAppendix = $navIcons['appendix']
    $html += "                <li class='nav-item' data-page='appendix-checks-run'><a href='#appendix-checks-run'>$navIconAppendix Appendix</a></li>`n"
}

$html += @"
            </ul>
        </nav>
        <main class="content" id="main-content" role="main">
"@

# Persistent branded banner -- visible on every page in paginated mode
if (-not $SkipCoverPage) {
    $html += @"

        <!-- Persistent branded banner (screen, all pages) -->
        <div class="hero-banner">
            <div class="hero-banner-left">
                $(if ($logoBase64) { "<img src='data:$logoMime;base64,$logoBase64' alt='Logo' class='hero-banner-logo'/>" } else { '' })
                <div class="hero-banner-text">
                    <div class="hero-banner-title">M365 Assessment Report</div>
                    <div class="hero-banner-meta">$(ConvertTo-HtmlSafe -Text $TenantName) &middot; $assessmentDate &middot; v$assessmentVersion</div>
                </div>
            </div>
        </div>
"@
}

if ($QuickScan) {
    $html += @"

        <div class="quickscan-banner">Quick Scan Mode &mdash; fast, low-permission triage focused on Critical and High severity findings</div>
"@
}

# Overview page: cover + exec summary + org profile combined
$html += @"

        <div class="report-page page-active" data-page="overview" id="overview">
"@

if (-not $SkipCoverPage) {
    # Full cover page (print only, hidden on screen)
    $html += @"

        <header class="cover-page cover-print-only">
            $logoImgTag
            <div class="cover-title">M365 Environment</div>
            <div class="cover-title" style="margin-top: 0;">Assessment Report</div>
            <div class="cover-divider"></div>
            <div class="cover-tenant">$(ConvertTo-HtmlSafe -Text $TenantName)</div>
            <div class="cover-subtitle">$assessmentDate</div>
            <div class="cover-date">v$assessmentVersion</div>
$(if (-not $NoBranding) {
@'
            <div class="cover-branding">
                <a href="https://github.com/Galvnyz/M365-Assess" target="_blank" rel="noopener" class="cover-branding-link">
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="cover-branding-icon"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                    <span>Open-source &mdash; M365-Assess on GitHub</span>
                </a>
            </div>
'@
})
        </header>
"@
}

# Inject org profile (tenant card) before exec summary
if ($tenantHtml.Length -gt 0) {
    $html += "`n        $($tenantHtml.ToString())"
}

# Findings alert — between org profile and exec summary
if ($allCisFindings.Count -gt 0 -and -not $SkipComplianceOverview) {
    $nonPassingCount = @($allCisFindings | Where-Object { $_.Status -ne 'Pass' }).Count
    if ($nonPassingCount -gt 0) {
        $html += @"

        <div class="exec-alert exec-alert-info">&#128270; <strong>$nonPassingCount finding(s)</strong> across
        $($allCisFindings.Count) controls require attention. See <a href="#compliance-overview">Compliance Overview</a>.</div>
"@
    }
}

if (-not $SkipExecutiveSummary) {
    $completePct = if ($totalCollectors -gt 0) { [math]::Round(($completeCount / $totalCollectors) * 100, 0) } else { 0 }
    $donutClass = if ($completePct -ge 90) { 'success' } elseif ($completePct -ge 70) { 'warning' } else { 'danger' }
    $donutSvg = Get-SvgDonut -Percentage $completePct -CssClass $donutClass -Label "$completeCount/$totalCollectors" -Size 120 -StrokeWidth 10

    # Pre-compute chart SVG for inline rendering
    $serviceAreaChartSvg = ''
    if ($sectionStatusCounts -and $sectionStatusCounts.Count -gt 0) {
        $chartRows = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($s in $sections) {
            if ($sectionStatusCounts.ContainsKey($s)) {
                $counts = $sectionStatusCounts[$s]
                $chartRows.Add(@{
                    Label   = $s
                    Pass    = $counts.Pass
                    Fail    = $counts.Fail
                    Warning = $counts.Warning
                    Review  = $counts.Review
                    Total   = $counts.Total
                })
            }
        }
        if ($chartRows.Count -gt 0) {
            $serviceAreaChartSvg = Get-SvgStackedBar -Rows @($chartRows)
        }
    }

    $html += @"

        <!-- Executive Summary — Hero Panel -->
        <div class="exec-hero">
            <div class="exec-hero-left">
                <h1 class="exec-hero-title">Executive Summary</h1>
                <p class="exec-hero-desc">Microsoft 365 environment assessment for
                <strong>$(ConvertTo-HtmlSafe -Text $TenantName)</strong> conducted on
                <strong>$assessmentDate</strong>.</p>
                <div class="exec-hero-donut">
                    $donutSvg
                    <div class="exec-hero-stats">
                        <div class="exec-hero-stat"><span class="chart-legend-dot dot-success"></span><strong>$completeCount</strong> Completed</div>
                        <div class="exec-hero-stat"><span class="chart-legend-dot dot-warning"></span><strong>$skippedCount</strong> Skipped</div>
                        <div class="exec-hero-stat"><span class="chart-legend-dot dot-danger"></span><strong>$failedCount</strong> Failed</div>
                    </div>
                </div>
            </div>
            <div class="exec-hero-right">
                <div class="service-area-chart-inline" id="service-area-chart">
                    <div class="service-area-chart-title">Service Area Breakdown</div>
                    $serviceAreaChartSvg
                </div>
            </div>
            <div class="exec-hero-metrics">
                <div class="exec-hero-metric">
                    <div class="exec-hero-metric-value">$totalCollectors</div>
                    <div class="exec-hero-metric-label">Config Areas</div>
                </div>
                <div class="exec-hero-metric">
                    <div class="exec-hero-metric-value">$($sections.Count)</div>
                    <div class="exec-hero-metric-label">Sections</div>
                </div>
                <div class="exec-hero-metric">
                    <div class="exec-hero-metric-value">$($allCisFindings.Count)</div>
                    <div class="exec-hero-metric-label">CIS Controls</div>
                </div>
                <div class="exec-hero-metric">
                    <div class="exec-hero-metric-value">$($allFrameworks.Count)</div>
                    <div class="exec-hero-metric-label">Security Frameworks</div>
                </div>
            </div>
        </div>
"@

    if ($issues.Count -gt 0) {
        $html += @"

        <div class="exec-alert exec-alert-warn">&#9888; <strong>$($issues.Count) issue(s)</strong> identified:
        $errorCount error(s) and $warningCount warning(s). See <a href="#issues">Technical Issues</a>.</div>
"@
    }

}

$html += "`n        </div>" # close overview report-page

if ($remediationPlanHtml) {
    $html += @"

        <div class="report-page" data-page="remediation-plan" id="remediation-plan">
        <a id="remediation-plan-anchor"></a>
        $remediationPlanHtml
        </div>
"@
}

$html += @"

        <div class="report-controls" id="reportControls">
            <button type="button" id="expandAllGlobal" class="report-ctrl-btn" title="Expand all sections and tables" aria-label="Expand all sections">&#9660; Expand All</button>
            <button type="button" id="collapseAllGlobal" class="report-ctrl-btn" title="Collapse all sections and tables" aria-label="Collapse all sections">&#9650; Collapse All</button>
        </div>

        $($sectionHtml.ToString())
"@

if ($complianceHtml) {
    $html += @"

        <div class="report-page" data-page="compliance-overview">
        <a id="compliance-overview"></a>
        <h1>Compliance Overview</h1>
        $complianceHtml
        </div>
"@
}

if ($catalogHtml) {
    $html += @"

        <div class="report-page" data-page="framework-catalogs">
        <a id="framework-catalogs"></a>
        <h1>Framework Catalogs</h1>
        $catalogHtml
        </div>
"@
}

if ($valueOpportunityHtml) {
    $html += "`n        <div class='report-page' data-page='value-opportunity' id='value-opportunity'>"
    $html += $valueOpportunityHtml
    $html += "`n        </div>"
}

if ($issues.Count -gt 0) {
    $html += @"

        <div class="report-page" data-page="issues">
        <a id="issues"></a>
        <h1>Technical Issues</h1>
        $($issuesHtml.ToString())
        </div>
"@
}

if ($checksRunHtml.Length -gt 0) {
    $html += @"

        <div class="report-page" data-page="appendix-checks-run">
        <a id="appendix-checks-run"></a>
        $($checksRunHtml.ToString())
        </div>
"@
}

$html += @"

        <!-- Footer -->
        <footer class="report-footer">
            <p>Generated by <a href="https://github.com/Galvnyz/M365-Assess" target="_blank" rel="noopener" class="m365a-name">M365 Assess</a>
            v$assessmentVersion</p>
            <p>$(Get-Date -Format 'MMMM d, yyyy h:mm tt')</p>
        </footer>
    </main>
    </div> <!-- close report-layout -->
    <script>
    // Theme toggle (sidebar button)
    (function() {
        var toggle = document.getElementById('navThemeToggle');
        var stored = localStorage.getItem('m365a-theme');
        if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.body.classList.add('dark-theme');
        }
        if (toggle) {
            toggle.addEventListener('click', function() {
                document.body.classList.toggle('dark-theme');
                localStorage.setItem('m365a-theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
            });
        }
    })();

    // Report metadata for client-side export
    var reportTenantName = '$(($TenantName -replace "'", "\'") -replace '<', '&lt;' -replace '>', '&gt;')';

    // --- Paginated Navigation ---
    (function() {
        var layout = document.getElementById('reportLayout');
        var nav = document.getElementById('reportNav');
        var navList = document.getElementById('navList');
        var showAllBtn = document.getElementById('navShowAll');
        var navToggleMobile = document.getElementById('navToggleMobile');
        var navOverlay = document.getElementById('navOverlay');
        if (!layout || !navList) return;

        var navItems = navList.querySelectorAll('.nav-item');
        var pages = layout.querySelectorAll('.report-page');
        var showAllMode = false;

        function getPageIds() {
            var ids = [];
            navItems.forEach(function(item) {
                var pageId = item.getAttribute('data-page');
                if (pageId) ids.push(pageId);
            });
            return ids;
        }

        function navigateTo(pageId, pushState) {
            if (showAllMode) {
                // In show-all mode, scroll to the page content div
                setActiveNav(pageId);
                var target = layout.querySelector('.report-page[data-page="' + pageId + '"]');
                if (target) {
                    var rect = target.getBoundingClientRect();
                    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                    window.scrollTo({ top: rect.top + scrollTop - 10, behavior: 'smooth' });
                }
                if (pushState !== false) history.replaceState(null, '', '#' + pageId);
                return;
            }
            // Hide all pages
            pages.forEach(function(p) { p.classList.remove('page-active'); });
            // Show target page
            var target = layout.querySelector('.report-page[data-page="' + pageId + '"]');
            if (target) {
                target.classList.add('page-active');
                // Ensure section details are open in paginated mode
                target.querySelectorAll('details.section').forEach(function(d) { d.open = true; });
                initPageTableExpand(target);
            } else if (pages.length > 0) {
                // Fallback to first page
                pages[0].classList.add('page-active');
                pageId = pages[0].getAttribute('data-page');
            }
            setActiveNav(pageId);
            // Hide expand/collapse controls on overview page (no collapsible sections)
            var controls = document.getElementById('reportControls');
            if (controls) controls.style.display = (pageId === 'overview') ? 'none' : '';
            // Scroll main content to top
            var main = document.getElementById('main-content');
            if (main) main.scrollTop = 0;
            window.scrollTo(0, layout.offsetTop);
            if (pushState !== false) history.pushState({ page: pageId }, '', '#' + pageId);
            closeMobileNav();
        }

        function setActiveNav(pageId) {
            navItems.forEach(function(item) {
                if (item.getAttribute('data-page') === pageId) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }

        function getInitialPage() {
            var hash = location.hash.replace('#', '');
            if (hash) {
                // Check if hash matches a data-page
                var match = layout.querySelector('.report-page[data-page="' + hash + '"]');
                if (match) return hash;
                // Check if hash matches an element inside a report-page
                var el = document.getElementById(hash);
                if (el) {
                    var parentPage = el.closest('.report-page');
                    if (parentPage) return parentPage.getAttribute('data-page');
                }
            }
            // Default to first nav item
            if (navItems.length > 0) return navItems[0].getAttribute('data-page');
            return null;
        }

        // Wire nav clicks
        navItems.forEach(function(item) {
            var link = item.querySelector('a');
            if (link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var pageId = item.getAttribute('data-page');
                    navigateTo(pageId);
                });
            }
        });

        // Intercept all in-page hash links (TOC, alerts, etc.) and route through navigateTo
        document.querySelectorAll('a[href^="#"]').forEach(function(link) {
            // Skip sidebar nav links (already handled above)
            if (link.closest('.nav-list')) return;
            link.addEventListener('click', function(e) {
                var hash = link.getAttribute('href').replace('#', '');
                if (!hash) return;
                // Check if hash matches a data-page directly
                var match = layout.querySelector('.report-page[data-page="' + hash + '"]');
                if (match) {
                    e.preventDefault();
                    navigateTo(hash);
                    return;
                }
                // Check if hash matches an element inside a report-page
                var el = document.getElementById(hash);
                if (el) {
                    var parentPage = el.closest('.report-page');
                    if (parentPage) {
                        e.preventDefault();
                        var pageId = parentPage.getAttribute('data-page');
                        if (showAllMode) {
                            setActiveNav(pageId);
                            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        } else {
                            navigateTo(pageId);
                        }
                    }
                }
            });
        });

        // Show All toggle
        if (showAllBtn) {
            showAllBtn.addEventListener('click', function() {
                showAllMode = !showAllMode;
                if (showAllMode) {
                    layout.classList.add('show-all-mode');
                    showAllBtn.textContent = 'Paginate';
                    showAllBtn.classList.add('active-toggle');
                    // Show all pages and keep current active highlighted
                    pages.forEach(function(p) { initPageTableExpand(p); });
                } else {
                    layout.classList.remove('show-all-mode');
                    showAllBtn.textContent = 'Show All';
                    showAllBtn.classList.remove('active-toggle');
                    // Re-navigate to currently active page
                    var activeItem = navList.querySelector('.nav-item.active');
                    var pageId = activeItem ? activeItem.getAttribute('data-page') : getInitialPage();
                    navigateTo(pageId, false);
                }
            });
        }

        // Mobile hamburger
        function openMobileNav() {
            if (nav) nav.classList.add('nav-open');
            if (navOverlay) navOverlay.classList.add('nav-overlay-active');
        }
        function closeMobileNav() {
            if (nav) nav.classList.remove('nav-open');
            if (navOverlay) navOverlay.classList.remove('nav-overlay-active');
        }
        if (navToggleMobile) {
            navToggleMobile.addEventListener('click', function() {
                if (nav && nav.classList.contains('nav-open')) {
                    closeMobileNav();
                } else {
                    openMobileNav();
                }
            });
        }
        if (navOverlay) {
            navOverlay.addEventListener('click', closeMobileNav);
        }

        // Browser back/forward
        window.addEventListener('popstate', function(e) {
            var pageId = (e.state && e.state.page) ? e.state.page : getInitialPage();
            if (pageId) navigateTo(pageId, false);
        });

        // Keyboard navigation
        navList.addEventListener('keydown', function(e) {
            var pageIds = getPageIds();
            var activeItem = navList.querySelector('.nav-item.active');
            var currentId = activeItem ? activeItem.getAttribute('data-page') : '';
            var idx = pageIds.indexOf(currentId);
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                if (idx < pageIds.length - 1) navigateTo(pageIds[idx + 1]);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                if (idx > 0) navigateTo(pageIds[idx - 1]);
            }
        });

        // Chart bar navigation -- click a service-area row to navigate to its section
        document.querySelectorAll('[data-nav]').forEach(function(el) {
            el.addEventListener('click', function() {
                var target = el.getAttribute('data-nav');
                if (target) navigateTo(target);
            });
            el.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    var target = el.getAttribute('data-nav');
                    if (target) navigateTo(target);
                }
            });
        });

        // Inject expand buttons and initialise column pickers for tables in a page
        // once it becomes visible. Must run after page-active is applied so
        // scrollHeight reflects real layout.
        function initPageTableExpand(page) {
            page.querySelectorAll('.collector-detail .table-wrapper:not([data-expand-init])').forEach(function(wrapper) {
                wrapper.setAttribute('data-expand-init', '1');
                if (wrapper.scrollHeight <= wrapper.clientHeight) { return; }
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'table-expand-btn';
                var iconSpan = document.createElement('span');
                iconSpan.setAttribute('aria-hidden', 'true');
                iconSpan.textContent = '\u2195';
                btn.appendChild(iconSpan);
                btn.appendChild(document.createTextNode(' Expand table'));
                btn.addEventListener('click', function() {
                    wrapper.classList.toggle('expanded');
                    var expanded = wrapper.classList.contains('expanded');
                    btn.lastChild.textContent = expanded ? ' Collapse table' : ' Expand table';
                });
                wrapper.parentNode.insertBefore(btn, wrapper.nextSibling);
            });
            initColPickers(page);
        }

        function toggleColumn(table, colKey, visible) {
            table.querySelectorAll('[data-col-key="' + colKey + '"]').forEach(function(el) {
                el.style.display = visible ? '' : 'none';
            });
        }

        function exportTableCsv(btn) {
            var detail = btn.closest('.collector-detail');
            if (!detail) { return; }
            var table = detail.querySelector('.data-table');
            if (!table) { return; }

            // Visible headers only (respect column picker)
            var headers = Array.from(table.querySelectorAll('thead th')).filter(function(th) {
                return th.style.display !== 'none';
            });
            var headerRow = headers.map(function(th) {
                return '"' + (th.textContent || '').replace(/"/g, '""') + '"';
            }).join(',');

            // Visible rows only (respect status filter)
            var dataRows = [];
            table.querySelectorAll('tbody tr').forEach(function(row) {
                if (row.style.display === 'none') { return; }
                var cells = headers.map(function(th) {
                    var colKey = th.getAttribute('data-col-key');
                    var cell = colKey ? row.querySelector('[data-col-key="' + colKey + '"]') : null;
                    var text = cell ? (cell.textContent || '').trim() : '';
                    return '"' + text.replace(/"/g, '""') + '"';
                });
                dataRows.push(cells.join(','));
            });

            var csv = [headerRow].concat(dataRows).join('\r\n');
            var heading = detail.querySelector('h3');
            var collectorName = heading ? heading.textContent.replace(/\s*\(\d+ rows\)\s*$/, '').trim() : 'export';
            var date = new Date().toISOString().slice(0, 10);
            var safeTenant = (reportTenantName || 'tenant').replace(/[^a-zA-Z0-9._-]/g, '_');
            var safeName   = collectorName.replace(/[^a-zA-Z0-9._-]/g, '_');
            var filename = safeName + '_' + safeTenant + '_' + date + '.csv';

            var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function initColPickers(page) {
            page.querySelectorAll('.col-picker-bar').forEach(function(bar) {
                if (bar.getAttribute('data-picker-init')) { return; }
                bar.setAttribute('data-picker-init', '1');
                var detail = bar.closest('.collector-detail');
                var table  = detail ? detail.querySelector('.data-table') : null;
                if (!table) { return; }
                if (!table.id) { table.id = 'tbl-' + Math.random().toString(36).slice(2, 8); }
                var storageKey = 'cols-' + table.id;
                var saved = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
                bar.querySelectorAll('.col-picker-item input').forEach(function(cb) {
                    var colKey       = cb.getAttribute('data-col-key');
                    var defaultHide  = cb.getAttribute('data-col-default') === 'hidden';
                    var isHidden     = saved.length ? saved.indexOf(colKey) > -1 : defaultHide;
                    cb.checked = !isHidden;
                    toggleColumn(table, colKey, !isHidden);
                    cb.addEventListener('change', function() {
                        toggleColumn(table, colKey, cb.checked);
                        var hidden = Array.from(bar.querySelectorAll('.col-picker-item input:not(:checked)'))
                            .map(function(c) { return c.getAttribute('data-col-key'); });
                        sessionStorage.setItem(storageKey, JSON.stringify(hidden));
                    });
                });
                var toggle = bar.querySelector('.col-picker-toggle');
                var panel  = bar.querySelector('.col-picker-panel');
                if (toggle && panel) {
                    toggle.addEventListener('click', function(e) {
                        e.stopPropagation();
                        panel.hidden = !panel.hidden;
                    });
                    document.addEventListener('click', function() {
                        if (!panel.hidden) { panel.hidden = true; }
                    });
                }
            });
        }

        // Initialize: show the correct page on load
        var initialPage = getInitialPage();
        if (initialPage) navigateTo(initialPage, false);
    })();

    document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('.data-table').forEach(function(table) {
            var headers = table.querySelectorAll('thead th');
            headers.forEach(function(th, colIndex) {
                th.addEventListener('click', function() {
                    sortTable(table, colIndex, th);
                });
            });
        });

        // --- Unified compliance filters ---
        var fwSelector = document.getElementById('fwSelector');
        var statusFilter = document.getElementById('statusFilter');
        var sectionFilter = document.getElementById('sectionFilter');
        var compTable = document.getElementById('complianceTable');
        var cards = document.querySelectorAll('.fw-card');

        if (compTable) {
            var compRows = compTable.querySelectorAll('tbody tr');
            var allFwCols = compTable.querySelectorAll('.fw-col');
            var fwCbs = fwSelector ? fwSelector.querySelectorAll('input[type="checkbox"]') : [];
            var statusCbs = statusFilter ? statusFilter.querySelectorAll('input[type="checkbox"]') : [];
            var sectionCbs = sectionFilter ? sectionFilter.querySelectorAll('input[type="checkbox"]') : [];

            function getActive(cbs, parentClass) {
                var active = [];
                cbs.forEach(function(cb) {
                    var lbl = cb.closest(parentClass);
                    if (cb.checked) { if (lbl) lbl.classList.add('active'); active.push(cb.value); }
                    else { if (lbl) lbl.classList.remove('active'); }
                });
                return active;
            }

            function applyAllFilters() {
                var activeFw = getActive(fwCbs, '.fw-checkbox');
                var activeStatus = getActive(statusCbs, '.status-checkbox');
                var activeSections = sectionCbs.length > 0
                    ? getActive(sectionCbs, '.section-checkbox')
                    : Array.from(new Set(Array.from(compRows).map(function(r) { return r.getAttribute('data-section') || ''; })));

                // 1. Toggle framework columns and cards
                allFwCols.forEach(function(el) {
                    var fw = el.getAttribute('data-fw');
                    el.style.display = activeFw.indexOf(fw) !== -1 ? '' : 'none';
                });
                cards.forEach(function(card) {
                    var fw = card.getAttribute('data-fw');
                    card.style.display = activeFw.indexOf(fw) !== -1 ? '' : 'none';
                });

                // 2. Filter rows by status + section
                var visibleCount = 0;
                compRows.forEach(function(row) {
                    var sec = row.getAttribute('data-section') || '';
                    var sectionOk = activeSections.indexOf(sec) !== -1;
                    var statusOk = false;
                    for (var i = 0; i < activeStatus.length; i++) {
                        if ((row.className || '').indexOf('cis-row-' + activeStatus[i]) !== -1) { statusOk = true; break; }
                    }
                    var show = sectionOk && statusOk;
                    row.style.display = show ? '' : 'none';
                    if (show) visibleCount++;
                });

                // 2b. Re-apply zebra striping to visible rows only
                var visIdx = 0;
                compRows.forEach(function(row) {
                    if (row.style.display !== 'none') {
                        row.classList.toggle('stripe-even', visIdx % 2 === 1);
                        visIdx++;
                    } else {
                        row.classList.remove('stripe-even');
                    }
                });

                // 3. No-results message
                var noResults = document.getElementById('complianceNoResults');
                if (noResults) noResults.style.display = visibleCount === 0 ? '' : 'none';

                // 4. Recalculate cards and status bar
                if (typeof complianceData !== 'undefined') {
                    recalculateCards(activeFw, activeSections);
                    recalculateStatusBar(activeSections);
                }
            }

            function recalculateCards(activeFw, activeSections) {
                cards.forEach(function(card) {
                    var fw = card.getAttribute('data-fw');
                    if (activeFw.indexOf(fw) === -1) return;
                    var catalogTotal = parseInt(card.getAttribute('data-catalog-total')) || 0;

                    var findings = complianceData.filter(function(f) {
                        return activeSections.indexOf(f.s) !== -1 && f.fw[fw];
                    });
                    var passCount = findings.filter(function(f) { return f.st === 'Pass'; }).length;
                    var total = findings.length;
                    var passRate = total > 0 ? (passCount / total * 100) : 0;
                    var coveragePct = catalogTotal > 0 ? Math.min(100, Math.round(total / catalogTotal * 100)) : 0;

                    var valEl = card.querySelector('.stat-value');
                    if (valEl) valEl.textContent = (total > 0 ? passRate.toFixed(1) : '0') + '%';
                    var subEl = card.querySelector('.stat-sublabel');
                    if (subEl) subEl.textContent = passCount + ' of ' + total + ' assessed';
                    var fill = card.querySelector('.coverage-fill');
                    if (fill) fill.style.width = coveragePct + '%';
                    var covLabel = card.querySelector('.coverage-label');
                    if (covLabel) covLabel.textContent = coveragePct + '% coverage';

                    card.classList.remove('success', 'warning', 'danger');
                    if (total === 0) { /* no class */ }
                    else if (passRate >= 80) card.classList.add('success');
                    else if (passRate >= 60) card.classList.add('warning');
                    else card.classList.add('danger');
                });
            }

            function recalculateStatusBar(activeSections) {
                var bar = document.querySelector('.compliance-status-bar');
                if (!bar || typeof complianceData === 'undefined') return;
                var findings = complianceData.filter(function(f) { return activeSections.indexOf(f.s) !== -1; });
                var total = findings.length;

                var statusMap = [
                    { css: 'pass', label: 'Pass' },
                    { css: 'fail', label: 'Fail' },
                    { css: 'warning', label: 'Warning' },
                    { css: 'review', label: 'Review' },
                    { css: 'info', label: 'Info' }
                ];
                var counts = {};
                statusMap.forEach(function(s) { counts[s.label] = 0; });
                findings.forEach(function(f) { if (counts.hasOwnProperty(f.st)) counts[f.st]++; });

                var totalEl = bar.querySelector('.compliance-bar-total');
                if (totalEl) totalEl.textContent = total + ' controls assessed';

                statusMap.forEach(function(s) {
                    var seg = bar.querySelector('.hbar-segment.hbar-' + s.css);
                    if (seg) {
                        var count = counts[s.label] || 0;
                        var pct = total > 0 ? (count / total * 100) : 0;
                        seg.style.width = pct > 0 ? pct + '%' : '0';
                        seg.style.display = pct > 0 ? '' : 'none';
                        seg.title = s.label + ': ' + count;
                        var lbl = seg.querySelector('.hbar-label');
                        if (lbl) lbl.textContent = count > 0 ? count : '';
                    }
                });

                bar.querySelectorAll('.hbar-legend-item').forEach(function(item) {
                    var text = item.textContent;
                    var match = text.match(/^(.+?)\s*\(\d+\)$/);
                    if (match) {
                        var label = match[1].trim();
                        var count = counts[label] || 0;
                        if (count > 0) {
                            item.textContent = label + ' (' + count + ')';
                            item.style.display = '';
                        } else {
                            item.style.display = 'none';
                        }
                    }
                });
            }

            // Wire up change handlers
            fwCbs.forEach(function(cb) { cb.addEventListener('change', applyAllFilters); });
            statusCbs.forEach(function(cb) { cb.addEventListener('change', applyAllFilters); });
            sectionCbs.forEach(function(cb) { cb.addEventListener('change', applyAllFilters); });

            // All/None buttons -- framework
            var fwAll = document.getElementById('fwSelectAll');
            var fwNone = document.getElementById('fwSelectNone');
            if (fwAll) fwAll.addEventListener('click', function() { fwCbs.forEach(function(cb) { cb.checked = true; }); applyAllFilters(); });
            if (fwNone) fwNone.addEventListener('click', function() { fwCbs.forEach(function(cb) { cb.checked = false; }); applyAllFilters(); });

            // All/None buttons -- status
            var sAll = document.getElementById('statusSelectAll');
            var sNone = document.getElementById('statusSelectNone');
            if (sAll) sAll.addEventListener('click', function() { statusCbs.forEach(function(cb) { cb.checked = true; }); applyAllFilters(); });
            if (sNone) sNone.addEventListener('click', function() { statusCbs.forEach(function(cb) { cb.checked = false; }); applyAllFilters(); });

            // All/None buttons -- section
            var secAll = document.getElementById('sectionSelectAll');
            var secNone = document.getElementById('sectionSelectNone');
            if (secAll) secAll.addEventListener('click', function() { sectionCbs.forEach(function(cb) { cb.checked = true; }); applyAllFilters(); });
            if (secNone) secNone.addEventListener('click', function() { sectionCbs.forEach(function(cb) { cb.checked = false; }); applyAllFilters(); });

            // Initialize
            applyAllFilters();
        }

        // --- Expand/Collapse All buttons ---
        document.querySelectorAll('.expand-all-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var section = btn.closest('.section');
                if (section) {
                    section.querySelectorAll('.collector-detail').forEach(function(d) { d.open = true; });
                }
            });
        });
        document.querySelectorAll('.collapse-all-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var section = btn.closest('.section');
                if (section) {
                    section.querySelectorAll('.collector-detail').forEach(function(d) { d.open = false; });
                }
            });
        });

        // --- Global Expand/Collapse All ---
        var expandAllGlobal = document.getElementById('expandAllGlobal');
        var collapseAllGlobal = document.getElementById('collapseAllGlobal');
        if (expandAllGlobal) {
            expandAllGlobal.addEventListener('click', function() {
                document.querySelectorAll('details').forEach(function(d) { d.open = true; });
            });
        }
        if (collapseAllGlobal) {
            collapseAllGlobal.addEventListener('click', function() {
                document.querySelectorAll('details').forEach(function(d) { d.open = false; });
            });
        }

        // --- Table-level status filters (security config tables) ---
        document.querySelectorAll('.table-status-filter').forEach(function(filterBar) {
            // Use querySelector rather than nextElementSibling so that intermediate
            // siblings (e.g. col-picker-bar) do not break the lookup.
            var tableWrapper = filterBar.parentElement ? filterBar.parentElement.querySelector('.table-wrapper') : null;
            if (!tableWrapper) return;
            var table = tableWrapper.querySelector('table');
            if (!table) return;
            var rows = table.querySelectorAll('tbody tr');
            var cbs = filterBar.querySelectorAll('.status-checkbox input[type="checkbox"]');

            function applyFilter() {
                var active = [];
                cbs.forEach(function(cb) {
                    var lbl = cb.closest('.status-checkbox');
                    if (cb.checked) { lbl.classList.add('active'); active.push(cb.value); }
                    else { lbl.classList.remove('active'); }
                });
                rows.forEach(function(row) {
                    var show = false;
                    for (var i = 0; i < active.length; i++) {
                        if ((row.className || '').indexOf('cis-row-' + active[i]) !== -1) { show = true; break; }
                    }
                    row.style.display = show ? '' : 'none';
                });
            }

            cbs.forEach(function(cb) { cb.addEventListener('change', applyFilter); });

            var btnAll = filterBar.querySelector('.tbl-status-all');
            var btnNone = filterBar.querySelector('.tbl-status-none');
            if (btnAll) btnAll.addEventListener('click', function() { cbs.forEach(function(cb) { cb.checked = true; }); applyFilter(); });
            if (btnNone) btnNone.addEventListener('click', function() { cbs.forEach(function(cb) { cb.checked = false; }); applyFilter(); });

            applyFilter();
        });
    });

    function sortTable(table, colIndex, th) {
        var tbody = table.querySelector('tbody');
        if (!tbody) return;
        var rows = Array.from(tbody.querySelectorAll('tr'));
        var currentDir = th.getAttribute('data-sort-dir') || 'none';
        var newDir = currentDir === 'asc' ? 'desc' : 'asc';

        th.closest('thead').querySelectorAll('th').forEach(function(h) {
            h.setAttribute('data-sort-dir', 'none');
            h.classList.remove('sort-asc', 'sort-desc');
        });

        th.setAttribute('data-sort-dir', newDir);
        th.classList.add('sort-' + newDir);

        rows.sort(function(a, b) {
            var aVal = a.cells[colIndex] ? a.cells[colIndex].textContent.trim() : '';
            var bVal = b.cells[colIndex] ? b.cells[colIndex].textContent.trim() : '';

            var aNum = parseFloat(aVal);
            var bNum = parseFloat(bVal);
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return newDir === 'asc' ? aNum - bNum : bNum - aNum;
            }

            var cmp = aVal.localeCompare(bVal, undefined, {sensitivity: 'base'});
            return newDir === 'asc' ? cmp : -cmp;
        });

        rows.forEach(function(row) { tbody.appendChild(row); });
    }

    // --- Donut chart interactive highlighting ---
    // Hover a legend row to highlight both the row and its matching SVG segment
    document.querySelectorAll('.dash-panel-details .score-detail-row').forEach(function(row) {
        var dot = row.querySelector('.chart-legend-dot');
        if (!dot) return;
        // Detect segment type from dot-* class
        var seg = null;
        dot.classList.forEach(function(c) {
            if (c.indexOf('dot-') === 0) seg = c.substring(4);
        });
        if (!seg) return;
        var panel = row.closest('.dash-panel');
        if (!panel) return;

        row.addEventListener('mouseenter', function() {
            panel.classList.add('donut-hover-active');
            row.classList.add('donut-highlight');
            panel.querySelectorAll('.donut-fill[data-segment="' + seg + '"]').forEach(function(c) {
                c.classList.add('donut-highlight');
            });
        });
        row.addEventListener('mouseleave', function() {
            panel.classList.remove('donut-hover-active');
            row.classList.remove('donut-highlight');
            panel.querySelectorAll('.donut-fill.donut-highlight').forEach(function(c) {
                c.classList.remove('donut-highlight');
            });
        });
    });

    function copyRemediation(btn) {
        var text = btn.previousElementSibling.textContent;
        navigator.clipboard.writeText(text).then(function() {
            btn.textContent = '\u2713';
            btn.classList.add('copied');
            setTimeout(function() {
                btn.textContent = '\uD83D\uDCCB';
                btn.classList.remove('copied');
            }, 1500);
        });
    }

    // --- Tab switching for callout-tabs ---
    document.querySelectorAll('.tab-header .tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tabGroup = this.closest('.callout-tabs');
            tabGroup.querySelectorAll('.tab-btn').forEach(function(b) {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            tabGroup.querySelectorAll('.tab-panel').forEach(function(p) {
                p.classList.remove('active');
            });
            this.classList.add('active');
            this.setAttribute('aria-selected', 'true');
            var panel = tabGroup.querySelector('#' + this.getAttribute('aria-controls'));
            if (panel) panel.classList.add('active');
        });
    });

    // --- Remediation Plan chip filters ---
    function getActiveRemValues(groupId, dataAttr) {
        var vals = [];
        document.querySelectorAll('#' + groupId + ' .fw-checkbox').forEach(function(chip) {
            var cb = chip.querySelector('input[type="checkbox"]');
            if (cb && cb.checked) { vals.push(chip.getAttribute(dataAttr)); }
        });
        return vals;
    }

    function filterRemediationTable() {
        var table = document.getElementById('remediationTable');
        if (!table) { return; }
        var rows       = table.querySelectorAll('tbody tr');
        var activeSevs = getActiveRemValues('remSeverityChips', 'data-severity');
        var secChips   = document.querySelectorAll('#remSectionChips .fw-checkbox');
        var activeSecs = getActiveRemValues('remSectionChips', 'data-section');
        var noSecChips = secChips.length === 0;
        var visible    = 0;
        rows.forEach(function(row) {
            var sev  = row.getAttribute('data-severity');
            var sec  = row.getAttribute('data-section');
            var show = activeSevs.indexOf(sev) !== -1 &&
                       (noSecChips || activeSecs.indexOf(sec) !== -1);
            row.style.display = show ? '' : 'none';
            if (show) { visible++; }
        });
        var countEl = document.getElementById('remMatchCount');
        if (countEl) { countEl.textContent = '(' + visible + ' finding' + (visible === 1 ? '' : 's') + ')'; }
        var vp  = document.getElementById('remTableViewport');
        var smb = document.getElementById('remShowMoreBtn');
        if (smb && vp && !vp.classList.contains('expanded')) {
            smb.textContent = '\u25BC Show all ' + visible + ' findings';
        }
        var noResults = document.getElementById('remNoResults');
        if (noResults) { noResults.style.display = (visible === 0) ? '' : 'none'; }
        updateRemChipCounts(activeSevs, activeSecs, noSecChips, rows);
    }

    function updateRemChipCounts(activeSevs, activeSecs, noSecChips, rows) {
        document.querySelectorAll('#remSeverityChips .fw-checkbox').forEach(function(chip) {
            var sev = chip.getAttribute('data-severity');
            var n   = 0;
            rows.forEach(function(row) {
                var sec = row.getAttribute('data-section');
                if (row.getAttribute('data-severity') === sev &&
                    (noSecChips || activeSecs.indexOf(sec) !== -1)) { n++; }
            });
            var el = chip.querySelector('.rem-chip-count');
            if (el) { el.textContent = n; }
        });
        document.querySelectorAll('#remSectionChips .fw-checkbox').forEach(function(chip) {
            var sec = chip.getAttribute('data-section');
            var n   = 0;
            rows.forEach(function(row) {
                if (row.getAttribute('data-section') === sec &&
                    activeSevs.indexOf(row.getAttribute('data-severity')) !== -1) { n++; }
            });
            var el = chip.querySelector('.rem-chip-count');
            if (el) { el.textContent = n; }
        });
    }

    function toggleRemChip(label) {
        var cb = label.querySelector('input[type="checkbox"]');
        if (cb) { cb.checked = !cb.checked; }
        label.classList.toggle('active', cb ? cb.checked : false);
        filterRemediationTable();
    }

    function setAllRemChips(btn) {
        var activate = btn.classList.contains('rem-chips-all');
        var section  = btn.closest('.rem-chip-section');
        if (!section) { return; }
        section.querySelectorAll('.fw-checkbox').forEach(function(chip) {
            var cb = chip.querySelector('input[type="checkbox"]');
            if (cb) { cb.checked = activate; }
            chip.classList.toggle('active', activate);
        });
        filterRemediationTable();
    }


    </script>
</body>
</html>
"@
