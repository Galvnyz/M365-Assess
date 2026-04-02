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
        /* Consolidated Read More callout toggle */
        .callout-readmore {
            margin: 0 0 16px 0;
        }
        .callout-readmore-toggle {
            font-size: 9.5pt;
            font-weight: 600;
            color: var(--m365a-accent);
            cursor: pointer;
            padding: 6px 0;
            list-style: none;
        }
        .callout-readmore-toggle::-webkit-details-marker { display: none; }
        .callout-readmore-toggle:hover { text-decoration: underline; }
        .callout-readmore-body {
            margin-top: 12px;
        }
        .callout-readmore-body .section-description {
            font-size: 9.5pt;
            color: var(--m365a-medium-gray);
            line-height: 1.6;
            margin: 0 0 12px 0;
        }
        .callout-readmore-body .section-description a { color: var(--m365a-accent); }
        .callout-cards {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }
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
            color: var(--m365a-dark);
            border-bottom: 1px solid var(--m365a-border);
        }
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
            margin: 8px 0 18px 0;
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
            max-width: 340px;
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
            max-width: 140px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
            transition: max-width 0.2s ease, white-space 0.2s ease;
        }
        .chip-note.expanded {
            max-width: 600px;
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

        /* Scrollable data tables — max ~25 rows visible */
        .collector-detail .table-wrapper {
            max-height: 800px;
            overflow-y: auto;
            overflow-x: auto;
        }

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
        .fw-pci   { background: #fef2f2; color: #991b1b; }
        .fw-cmmc  { background: #f0fdfa; color: #134e4a; }
        .fw-hipaa { background: #fdf2f8; color: #9d174d; }
        .fw-scuba { background: #fff7ed; color: #9a3412; }
        .fw-soc2  { background: #eff6ff; color: #1e3a5f; }
        .fw-fedramp { background: #fef3c7; color: #78350f; }
        .fw-essential8 { background: #ecfdf5; color: #14532d; }
        .fw-mitre { background: #fef2f2; color: #7f1d1d; }
        .fw-cisv8 { background: #e0f2fe; color: #0c4a6e; }
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
        .matrix-table tbody tr.cis-row-pass:hover { background-color: var(--m365a-success); opacity: 0.85; }
        .matrix-table tbody tr.cis-row-fail:hover { background-color: var(--m365a-danger); opacity: 0.85; }
        .matrix-table tbody tr.cis-row-warning:hover { background-color: var(--m365a-warning); opacity: 0.85; }
        .matrix-table tbody tr.cis-row-review:hover { background-color: var(--m365a-accent); opacity: 0.85; }
        .matrix-table tbody tr.cis-row-info:hover { background-color: var(--m365a-neutral); opacity: 0.85; }
        .matrix-table tbody tr.cis-row-unknown:hover { background-color: var(--m365a-medium-gray); opacity: 0.85; }
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

        body.dark-theme .fw-cis    { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .fw-cis-l2 { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-nist   { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .fw-nist-high { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-nist-privacy { background: #2E1065; color: #C4B5FD; }
        body.dark-theme .fw-csf    { background: #78350F; color: #FCD34D; }
        body.dark-theme .fw-iso    { background: #064E3B; color: #6EE7B7; }
        body.dark-theme .fw-stig   { background: #3B0764; color: #C4B5FD; }
        body.dark-theme .fw-pci    { background: #7F1D1D; color: #FCA5A5; }
        body.dark-theme .fw-cmmc   { background: #134E4A; color: #5EEAD4; }
        body.dark-theme .fw-hipaa  { background: #831843; color: #F9A8D4; }
        body.dark-theme .fw-scuba  { background: #7C2D12; color: #FDBA74; }
        body.dark-theme .fw-soc2   { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-fedramp { background: #78350F; color: #FCD34D; }
        body.dark-theme .fw-essential8 { background: #064E3B; color: #6EE7B7; }
        body.dark-theme .fw-mitre { background: #7F1D1D; color: #FCA5A5; }
        body.dark-theme .fw-cisv8 { background: #0C4A6E; color: #7DD3FC; }
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
        .nav-separator {
            height: 1px;
            background: var(--m365a-border);
            margin: 6px 16px;
        }

        /* Page visibility */
        .report-page { display: none; }
        .report-page.page-active { display: block; }
        .report-layout.show-all-mode .report-page { display: block; }

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
            .matrix-controls { display: none; }
            .matrix-table tr { display: table-row !important; }
            .fw-col { display: table-cell !important; }

            /* --- Callouts: expand and simplify for print --- */
            .callout-readmore { open: true; }
            .callout-readmore-toggle { pointer-events: none; }
            .callout-readmore-body { display: flex !important; }
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

            @page {
                size: letter;
                margin: 0.75in;
            }

            @page :first {
                margin: 0;
            }
        }
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
                <a href="https://github.com/Galvnyz/M365-Assess" target="_blank" rel="noopener" class="nav-title">M365 Assess</a>
                <button class="nav-show-all" id="navShowAll" title="Toggle between paginated and scrollable view">Show All</button>
                <button class="nav-theme-btn" id="navThemeToggle" aria-label="Toggle dark mode" title="Toggle light/dark mode">
                    <span class="nav-theme-light">&#9788;</span>
                    <span class="nav-theme-dark">&#9790;</span>
                </button>
            </div>
            <ul class="nav-list" id="navList">
"@

# Fluent UI-inspired inline SVG icons for sidebar navigation (MIT licensed paths)
$navIcons = @{
    'overview'            = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.5L2 9h3v7h4v-4h2v4h4V9h3L10 2.5z"/></svg>'
    'identity'            = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a3 3 0 100 6 3 3 0 000-6zM4 14c0-2 4-3 6-3s6 1 6 3v2H4v-2z"/></svg>'
    'licensing'           = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M7 10a3 3 0 116 0 3 3 0 01-6 0zm3-1.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM12 10h5v2h-2v3h-2v-3h-1v-2z"/></svg>'
    'email'               = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M2 5l8 5 8-5v10H2V5zm2 1.5V14h12V6.5l-6 3.75L4 6.5z"/></svg>'
    'intune'              = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M7 2h6a1 1 0 011 1v14a1 1 0 01-1 1H7a1 1 0 01-1-1V3a1 1 0 011-1zm1 2v10h4V4H8zm2 11a1 1 0 100 2 1 1 0 000-2z"/></svg>'
    'security'            = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 1L3 4v5c0 4.5 3 8.7 7 9.6 4-.9 7-5.1 7-9.6V4l-7-3zm0 2.2l5 2.1v3.7c0 3.5-2.2 6.7-5 7.5-2.8-.8-5-4-5-7.5V5.3l5-2.1z"/></svg>'
    'collaboration'       = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M6 5a2 2 0 110 4 2 2 0 010-4zm8 0a2 2 0 110 4 2 2 0 010-4zM2 13c0-1.5 3-2.5 4-2.5s4 1 4 2.5V15H2v-2zm8 0c0-1.5 3-2.5 4-2.5s4 1 4 2.5V15h-8v-2z"/></svg>'
    'hybrid'              = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M14.5 3L17 5.5 14.5 8V6A4.5 4.5 0 0110 14.5v2A6.5 6.5 0 0014.5 4V3zM5.5 17L3 14.5 5.5 12v2A4.5 4.5 0 0110 5.5v-2A6.5 6.5 0 005.5 16v1z"/></svg>'
    'inventory'           = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M4 4c0-1.1 2.7-2 6-2s6 .9 6 2v2c0 1.1-2.7 2-6 2S4 7.1 4 6V4zm0 5c1.4.8 3.6 1 6 1s4.6-.2 6-1v2c0 1.1-2.7 2-6 2S4 12.1 4 11V9zm0 5c1.4.8 3.6 1 6 1s4.6-.2 6-1v2c0 1.1-2.7 2-6 2S4 17.1 4 16v-2z"/></svg>'
    'soc2'                = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a4 4 0 00-4 4v2H5a1 1 0 00-1 1v8a1 1 0 001 1h10a1 1 0 001-1V9a1 1 0 00-1-1h-1V6a4 4 0 00-4-4zm-2 4a2 2 0 114 0v2H8V6z"/></svg>'
    'powerbi'             = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M3 17V8h3v9H3zm5 0V3h3v14H8zm5 0V6h3v11h-3z"/></svg>'
    'activedirectory'     = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M6 2h5l5 5v11H6V2zm4 1v4h4l-4-4z"/></svg>'
    'compliance overview' = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M4 2h12a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zm5 12l6-6-1.4-1.4L9 11.2 6.4 8.6 5 10l4 4z"/></svg>'
    'framework catalogs'  = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M4 3h5v14H4V3zm7 0h5v14h-5V3zM3 2v16h14V2H3z"/></svg>'
    'technical issues'    = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2L1 18h18L10 2zm0 4l6 10H4l6-10zm-1 4v3h2v-3H9zm0 4v2h2v-2H9z"/></svg>'
    'appendix'            = '<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M6 2h5l5 5v11H6V2zm4 1v4h4l-4-4z"/></svg>'
}

# Build sidebar nav items -- Overview combines cover + exec summary + org profile
$navIconOverview = $navIcons['overview']
$html += "                <li class='nav-item active' data-page='overview'><a href='#overview'>$navIconOverview Overview</a></li>`n"
foreach ($navSection in $sections) {
    # Tenant is merged into Overview page -- skip separate nav entry
    if ($navSection -eq 'Tenant') { continue }

    $navPageId = "section-$(($navSection -replace '[^a-zA-Z0-9]', '-').ToLower())"
    $navLabel = [System.Web.HttpUtility]::HtmlEncode($navSection)
    $navBadge = ''
    if ($sectionStatusCounts.ContainsKey($navSection)) {
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
    $navIconKey = $navSection.ToLower()
    $navIconSvg = if ($navIcons.ContainsKey($navIconKey)) { $navIcons[$navIconKey] } else { '' }
    $html += "                <li class='nav-item' data-page='$navPageId'><a href='#$navPageId'>$navIconSvg $navLabel$navBadge</a></li>`n"
}

# Separator before extra sections
$hasExtraSections = ($complianceHtml) -or ($catalogHtml) -or ($issues.Count -gt 0) -or ($allCisFindings.Count -gt 0)
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

# Overview page: cover + exec summary + org profile combined
$html += @"

        <div class="report-page page-active" data-page="overview" id="overview">
"@

if (-not $SkipCoverPage) {
    # Compact hero banner for screen; full cover page rendered in print CSS only
    $html += @"

        <!-- Compact branded banner (screen) -->
        <div class="hero-banner">
            <div class="hero-banner-left">
                $(if ($logoBase64) { "<img src='data:$logoMime;base64,$logoBase64' alt='Logo' class='hero-banner-logo'/>" } else { '' })
                <div class="hero-banner-text">
                    <div class="hero-banner-title">M365 Assessment Report</div>
                    <div class="hero-banner-meta">$(ConvertTo-HtmlSafe -Text $TenantName) &middot; $assessmentDate &middot; v$assessmentVersion</div>
                </div>
            </div>
        </div>
        <!-- Full cover page (print only, hidden on screen) -->
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
            var tableWrapper = filterBar.nextElementSibling;
            if (!tableWrapper) return;
            var table = tableWrapper.querySelector('table');
            if (!table) return;
            var rows = table.querySelectorAll('tbody tr');
            var cbs = filterBar.querySelectorAll('input[type="checkbox"]');

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
    </script>
</body>
</html>
"@
