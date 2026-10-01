type ProfileUser = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type UserProfile = Omit<ProfileUser, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export function profile(user: ProfileUser): UserProfile {
  const createdAt = user.createdAt.toISOString();
  const updatedAt = user.updatedAt.toISOString();
  return { ...user, createdAt, updatedAt };
}
