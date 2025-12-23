from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0032_cardioworkout_mph_goal_strategy"),
    ]

    operations = [
        migrations.AddField(
            model_name="specialrule",
            name="pyramid_reps_rest_per_rep",
            field=models.FloatField(default=1.0),
        ),
        migrations.AddField(
            model_name="specialrule",
            name="pyramid_time_rest_per_second",
            field=models.FloatField(default=1.0),
        ),
    ]

