import JSZip from 'jszip';
import type { GithubApiClient } from '../core/github-api-client';

export interface GitZipOptions {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  githubApi: GithubApiClient;
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
  const { owner, repo, ref, path, githubApi, onProgress } = options;

  try {
    onProgress?.('prepare', 'Fetching folder contents...', 0);

    // Get the commit for this ref (works for branches, tags, and commit SHAs)
    const commitData = await githubApi.getJson<{ commit: { tree: { sha: string } } }>(
      `/repos/${owner}/${repo}/commits/${ref}`
    );

    const treeSha = commitData.commit.tree.sha;

    // Get the full tree recursively
    const treeData: TreeResponse = await githubApi.getJson<TreeResponse>(
      `/repos/${owner}/${repo}/git/trees/${treeSha}`,
      { recursive: '1' }
    );

    if (treeData.truncated) {
      throw new Error('Repository tree is too large (truncated). Try downloading a smaller folder.');
    }

    // Filter files within the target path
    // Decode path for comparison (GitHub URLs are encoded but tree paths are not)
    const decodedPath = decodeURIComponent(path);
    const targetPath = decodedPath.endsWith('/') ? decodedPath : `${decodedPath}/`;
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
        const blobData = await githubApi.getJson<{ content: string }>(
          `/repos/${owner}/${repo}/git/blobs/${file.sha}`
        );

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
  path: string,
  githubApi: GithubApiClient
): Promise<number> {
  try {
    // Get the commit for this ref (works for branches, tags, and commit SHAs)
    const commitData = await githubApi.getJson<{ commit: { tree: { sha: string } } }>(
      `/repos/${owner}/${repo}/commits/${ref}`
    );

    const treeSha = commitData.commit.tree.sha;

    // Get the full tree recursively
    const treeData: TreeResponse = await githubApi.getJson<TreeResponse>(
      `/repos/${owner}/${repo}/git/trees/${treeSha}`,
      { recursive: '1' }
    );

    // Filter files within the target path
    // Decode path for comparison (GitHub URLs are encoded but tree paths are not)
    const decodedPath = decodeURIComponent(path);
    const targetPath = decodedPath.endsWith('/') ? decodedPath : `${decodedPath}/`;
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
