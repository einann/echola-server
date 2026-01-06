export class UserProfileResponseDto {
  id: string;
  email: string;
  displayName: string | null;
  username: string | null;
  bio: string | null;
  avatarUrl: string | null;
  statusMessage: string | null;
  isOnline: boolean;
  lastSeenAt: Date | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class UserSearchResultDto {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
}

export class SearchUsersResponseDto {
  users: UserSearchResultDto[];
  total: number;
  limit: number;
  offset: number;
}
