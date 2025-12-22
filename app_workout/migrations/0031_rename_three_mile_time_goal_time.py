from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0030_alter_cardioworkout_goal_distance"),
    ]

    operations = [
        migrations.RenameField(
            model_name="cardiodailylog",
            old_name="three_mile_time",
            new_name="goal_time",
        ),
    ]
