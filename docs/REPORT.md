# HTML Assessment Report

The assessment generates a self-contained HTML report (`_Assessment-Report.html`) that can be emailed directly to clients. No external dependencies, no assets folder needed. All logos are base64-encoded, styles and scripts are embedded inline.

## Report Features

- **Light / Dark mode** with floating toggle button, automatic detection via `prefers-color-scheme`, and `localStorage` persistence. Every element is themed: badges, framework tags, stat cards, table headers, and compliance rows all adapt.
- **Cover page** with M365 Assess branding (or your custom branding) and tenant name
- **Organization profile card** showing org name, primary domain, creation date, and security defaults status
- **Executive summary** with section/collector stat cards and issue overview
- **Identity KPIs** including total users, licensed users, MFA adoption %, SSPR enrollment %, and guest count (MFA/SSPR exclude non-capable accounts from the denominator)
- **Section-by-section data tables** with executive descriptions explaining what each area covers and why it matters
- **Collapsible sub-sections** with row counts, keeping the report scannable
- **Sortable column headers** for ascending/descending sort on any column
- **Security config donut charts** for each domain (Entra, EXO, Defender, SharePoint, Teams) with Pass/Fail/Warning/Review/Info breakdown
- **Color-coded status badges** (Pass/Fail/Warning/Review/Info) with row-level tinting on security config tables
- **Status filter buttons** to show/hide rows by status
- **Microsoft Secure Score** visual stat cards and progress bar with comparison to M365 global average
- **Compliance Overview** with interactive framework selector, coverage cards, and cross-reference matrix (see [COMPLIANCE.md](COMPLIANCE.md))
- **Issues & recommendations** with severity badges and remediation guidance
- **Accessibility** with semantic HTML landmarks, `scope="col"` on table headers, focus-visible outlines
- **Print-friendly** with automatic page breaks and repeated table headers when printing to PDF

## Standalone Report Generation

Re-generate the HTML report from existing CSV data without re-running the full assessment:

```powershell
.\Common\Export-AssessmentReport.ps1 -AssessmentFolder '.\M365-Assessment\Assessment_YYYYMMDD_HHMMSS'
```

This is useful for:
- Regenerating the report after a branding change
- Testing report layout changes against existing data
- Generating reports from CSV data collected on another system

## Custom Branding

Replace the images in `Common/assets/` with your own:

| File | Purpose | Format | Recommended Size |
|------|---------|--------|-----------------|
| `m365-assess-logo.png` | Report cover page logo | PNG | 400 x 120 px |
| `m365-assess-logo-white.png` | Light-on-dark variant (optional) | PNG | 400 x 120 px |
| `m365-assess-bg.png` | Cover page background | PNG | 1200 x 800 px |

The report engine base64-encodes these images at generation time, so the output file is fully self-contained.

### Removing Branding

Use `-NoBranding` to generate a clean report without the M365 Assess logo and cover page branding:

```powershell
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com' -NoBranding
```

This produces a professional report with your tenant name and data, but no third-party branding. Ideal for white-label delivery to clients.
