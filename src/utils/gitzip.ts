import JSZip from 'jszip';

export interface GitZipOptions {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  onProgress?: (status: string, message: string, percent: number) => void;
}

interface TreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

interface TreeResponse {
  sha: string;
  url: string;
  tree: TreeItem[];
  truncated: boolean;
}

/**
 * Download a folder from a GitHub repository as a ZIP file
 */
export async function downloadFolderAsZip(options: GitZipOptions): Promise<void> {
  const { owner, repo, ref, path, onProgress } = options;

  try {
    onProgress?.('prepare', 'Fetching folder contents...', 0);

    // Get the commit for this ref (works for branches, tags, and commit SHAs)
    const commitUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`;
    const commitResponse = await fetch(commitUrl);

    if (commitResponse.status === 403 || commitResponse.status === 429) {
      throw new Error('GitHub API rate limit reached. Please try again later or configure authentication.');
    }

    if (!commitResponse.ok) {
      throw new Error(`Failed to fetch commit: ${commitResponse.statusText}`);
    }

    const commitData = await commitResponse.json();
    const treeSha = commitData.commit.tree.sha;

    // Get the full tree recursively
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
    const treeResponse = await fetch(treeUrl);

    if (treeResponse.status === 403 || treeResponse.status === 429) {
      throw new Error('GitHub API rate limit reached. Please try again later or configure authentication.');
    }

    if (!treeResponse.ok) {
      throw new Error(`Failed to fetch tree: ${treeResponse.statusText}`);
    }

    const treeData: TreeResponse = await treeResponse.json();

    if (treeData.truncated) {
      throw new Error('Repository tree is too large (truncated). Try downloading a smaller folder.');
    }

    // Filter files within the target path
    const targetPath = path.endsWith('/') ? path : `${path}/`;
    const files = treeData.tree.filter(
      item => item.type === 'blob' && item.path.startsWith(targetPath)
    );

    if (files.length === 0) {
      throw new Error('No files found in the specified folder');
    }

    onProgress?.('processing', `Downloading ${files.length} files...`, 10);

    // Create ZIP file
    const zip = new JSZip();

    // Download and add each file to the ZIP
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const progress = 10 + Math.floor((i / files.length) * 80);

      onProgress?.('processing', `Downloading ${file.path}...`, progress);

      try {
        // Get file content using blob API
        const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${file.sha}`;
        const blobResponse = await fetch(blobUrl);

        if (!blobResponse.ok) {
          console.warn(`Failed to download ${file.path}, skipping...`);
          continue;
        }

        const blobData = await blobResponse.json();

        // Decode base64 content
        const content = atob(blobData.content);

        // Remove the target path prefix from the file path for ZIP structure
        const relativePath = file.path.substring(targetPath.length);

        // Add file to ZIP
        zip.file(relativePath, content, { binary: true });
      } catch (error) {
        console.error(`Error downloading ${file.path}:`, error);
      }
    }

    onProgress?.('processing', 'Creating ZIP file...', 90);

    // Generate ZIP file
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    onProgress?.('done', 'Download complete!', 100);

    // Trigger download
    const folderName = path.split('/').filter(Boolean).pop() || 'download';
    const downloadUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${folderName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    onProgress?.('error', errorMessage, 0);
    throw error;
  }
}

/**
 * Calculate the total size of files in a folder
 */
export async function calculateFolderSize(
  owner: string,
  repo: string,
  ref: string,
  path: string
): Promise<number> {
  try {
    // Get the commit for this ref (works for branches, tags, and commit SHAs)
    const commitUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`;
    const commitResponse = await fetch(commitUrl);

    // Silently return 0 on rate limit instead of throwing
    if (commitResponse.status === 403 || commitResponse.status === 429) {
      return 0;
    }

    if (!commitResponse.ok) {
      return 0;
    }

    const commitData = await commitResponse.json();
    const treeSha = commitData.commit.tree.sha;

    // Get the full tree recursively
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
    const treeResponse = await fetch(treeUrl);

    // Silently return 0 on rate limit
    if (treeResponse.status === 403 || treeResponse.status === 429) {
      return 0;
    }

    if (!treeResponse.ok) {
      return 0;
    }

    const treeData: TreeResponse = await treeResponse.json();

    // Filter files within the target path
    const targetPath = path.endsWith('/') ? path : `${path}/`;
    const files = treeData.tree.filter(
      item => item.type === 'blob' && item.path.startsWith(targetPath)
    );

    // Sum up file sizes
    return files.reduce((total, file) => total + (file.size || 0), 0);
  } catch (error) {
    // Silently return 0 instead of logging error
    return 0;
  }
}
