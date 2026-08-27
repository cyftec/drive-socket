export type DriveFileMetadata<F extends FileMetadataField> = Pick<
  GoogleDriveFileSchema,
  F
>;

export type FilesDownloadResult<F extends FileMetadataField> = {
  files?: DriveFileMetadata<F>[];
  nextPageToken?: string;
};

export type TimedFileQuery = {
  date: Date;
  includingDate?: boolean;
  relation: "since" | "until";
};

/**
 * START
 * file.field
 */
export type FileMetadataField = keyof GoogleDriveFileSchema;

export interface GoogleDriveFileSchema {
  // Basic & Core Identity
  id: string;
  name: string;
  mimeType: string;
  kind: "drive#file";
  description: string;

  // File Content & Size Details
  size: string; // Keep as string (Google API returns large ints as strings)
  md5Checksum: string;
  sha1Checksum: string;
  sha256Checksum: string;
  fileExtension: string;
  fullFileExtension: string;
  originalFilename: string;
  headRevisionId: string;

  // Timestamps (RFC 3339 Strings)
  createdTime: string;
  modifiedTime: string;
  modifiedByMeTime: string;
  viewedByMeTime: string;
  sharedWithMeTime: string;
  trashedTime: string;

  // Access Links
  webViewLink: string;
  webContentLink: string;
  iconLink: string;
  thumbnailLink: string;
  exportLinks: Record<string, string>;

  // Ownership & Permissions
  ownedByMe: boolean;
  shared: boolean;
  writersCanShare: boolean;
  copyRequiresWriterPermission: boolean;
  permissionIds: string[];
  owners: Array<{
    kind: "drive#user";
    displayName: string;
    photoLink?: string;
    me: boolean;
    permissionId: string;
    emailAddress: string;
  }>;
  permissions: Array<{
    kind: "drive#permission";
    id: string;
    type: "user" | "group" | "domain" | "anyone";
    emailAddress?: string;
    role:
      | "owner"
      | "organizer"
      | "fileOrganizer"
      | "writer"
      | "commenter"
      | "reader";
    displayName?: string;
    photoLink?: string;
    deleted?: boolean;
    pendingOwner?: boolean;
  }>;

  // Organization & Hierarchy
  parents: string[];
  spaces: string[];
  driveId: string;
  folderColorRgb: string;

  // State & Boolean Flags
  starred: boolean;
  trashed: boolean;
  explicitlyTrashed: boolean;
  viewedByMe: boolean;
  modifiedByMe: boolean;

  // Advanced Properties & Nested Objects
  capabilities: {
    canAddChildren?: boolean;
    canChangeCopyRequiresWriterPermission?: boolean;
    canChangeViewersCanCopyContent?: boolean;
    canComment?: boolean;
    canCopy?: boolean;
    canDelete?: boolean;
    canDownload?: boolean;
    canEdit?: boolean;
    canListChildren?: boolean;
    canMoveItemIntoTeamDrive?: boolean;
    canMoveItemWithinTeamDrive?: boolean;
    canMoveItemWithinDrive?: boolean;
    canReadRevisions?: boolean;
    canRename?: boolean;
    canShare?: boolean;
    canTrash?: boolean;
    canUntrash?: boolean;
  };
  contentHints: {
    thumbnail?: {
      image?: string; // base64url encoded
      mimeType?: string;
    };
    indexableText?: string;
  };
  imageMediaMetadata: {
    width?: number;
    height?: number;
    rotation?: number;
    location?: {
      latitude?: number;
      longitude?: number;
      altitude?: number;
    };
    time?: string;
    cameraMake?: string;
    cameraModel?: string;
    exposureTime?: number;
    aperture?: number;
    flashUsed?: boolean;
    focalLength?: number;
    isoSpeed?: number;
    meteringMode?: string;
    sensor?: string;
    exposureMode?: string;
    whiteBalance?: string;
    lens?: string;
  };
  videoMediaMetadata: {
    width?: number;
    height?: number;
    durationMillis?: number; // integer string represented or real number depending on internal client maps
  };
  shortcutDetails: {
    targetId: string;
    targetMimeType: string;
    targetResourceKey?: string;
  };
  properties: Record<string, string>;
  appProperties: Record<string, string>;
  labelInfo: {
    labels?: Array<{
      id: string;
      fields?: Record<string, any>;
      kind: string;
    }>;
  };
  resourceKey: string;
  linkShareMetadata: {
    securityUpdateEligible: boolean;
    securityUpdateEnabled: boolean;
  };
}

/**
 * END
 * file.field
 */
