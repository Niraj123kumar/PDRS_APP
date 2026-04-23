const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined
});

function validateRepoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const cleanUrl = url.trim();
    return /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(cleanUrl);
}

function parseRepoUrl(repoUrl) {
    const cleanUrl = repoUrl.trim().replace(/\/+$/, '');
    const match = cleanUrl.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/);
    if (!match) {
        throw new Error('Invalid GitHub repository URL');
    }
    return { owner: match[1], repo: match[2] };
}

function extractFromReadme(content, repo) {
    const lines = String(content || '').split('\n');
    const heading = lines.find((line) => line.trim().startsWith('# '));
    const title = heading ? heading.replace(/^#\s+/, '').trim() : repo;

    let description = '';
    let inParagraph = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) continue;
        if (!trimmed && !inParagraph) continue;
        if (!trimmed && inParagraph) break;
        if (trimmed) {
            description += (description ? ' ' : '') + trimmed;
            inParagraph = true;
        }
    }
    if (!description) {
        description = 'Imported from GitHub README.';
    }

    let techStack = '';
    const techStart = lines.findIndex((line) => /^##\s+Tech Stack/i.test(line.trim()));
    if (techStart >= 0) {
        const collected = [];
        for (let i = techStart + 1; i < lines.length; i += 1) {
            const trimmed = lines[i].trim();
            if (/^##\s+/.test(trimmed)) break;
            if (trimmed) collected.push(trimmed.replace(/^[-*]\s*/, ''));
        }
        techStack = collected.join(', ');
    }
    if (!techStack) {
        techStack = 'Not detected from README';
    }

    return { title, description, techStack };
}

async function importFromReadme(repoUrl) {
    const { owner, repo } = parseRepoUrl(repoUrl);
    const readme = await octokit.repos.getReadme({ owner, repo });
    const readmeContent = Buffer.from(readme.data.content || '', 'base64').toString('utf-8');
    const extracted = extractFromReadme(readmeContent, repo);
    return { ...extracted, repoUrl };
}

module.exports = {
    importFromReadme,
    validateRepoUrl
};
