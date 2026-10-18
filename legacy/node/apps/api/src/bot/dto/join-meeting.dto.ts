export class JoinMeetingDto {
  meetingUrl!: string;
  audioFilePath?: string;
  headless?: boolean;
  chromeProfilePath?: string;
  storageStatePath?: string;
}
