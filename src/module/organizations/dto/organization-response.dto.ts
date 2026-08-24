import { ApiProperty } from '@nestjs/swagger';

export class OrganizationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Public self-serve student join code' })
  joinCode: string;

  @ApiProperty({
    description:
      'Platform-level access switch (superadmin-controlled). False blocks every member from acting in this organization.',
  })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ description: 'Teacher memberships in this organization' })
  teacherCount: number;

  @ApiProperty({ description: 'Student memberships in this organization' })
  studentCount: number;
}
